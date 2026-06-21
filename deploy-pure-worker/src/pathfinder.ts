/**
 * MTR Pathfinder - 核心寻路算法 (TypeScript 版)
 * 
 * 原理: 使用 Dijkstra 算法在多式联运图上计算最短路径
 * 图结构: 节点=车站，边=线路区间、站内换乘、出站换乘、越野步行
 * 
 * 注意: 这是 Python networkx 版的简化版实现
 * 为适应 Workers CPU 时间限制 (10-50ms)，已做如下优化:
 *   - 使用邻接表 + 二叉堆 (优先队列)
 *   - 提前终止 (找到终点即停止)
 *   - 避免大量字符串比较
 */

import { Station, Route, TransportType, FindRouteRequest, FindRouteResult, PathSegment } from './types';

// ========== 交通工具平均速度 (blocks/second) ==========
const SPEED: Record<TransportType, number> = {
  'train_normal': 14,
  'train_light_rail': 11,
  'train_high_speed': 40,
  'boat_normal': 10,
  'boat_light_rail': 10,
  'boat_high_speed': 13,
  'cable_car_normal': 8,
  'airplane_normal': 70,
};

const TRANSFER_SPEED = 4.317;     // 出站换乘 (blocks/s)
const RUNNING_SPEED = 5.612;      // 站内换乘 (blocks/s)
const WILD_SPEED = 2.25;          // 越野步行 (blocks/s)
const MAX_WILD_BLOCKS = 1500;     // 越野最大距离

// ========== 图的边类型 ==========
interface Edge {
  to: string;              // 目标站 ID
  weight: number;          // 时间权重 (秒)
  routeId?: string;        // 乘坐的线路 ID（换乘/步行时为空）
  routeName?: string;      // 线路显示名
  edgeType: 'ride' | 'transfer' | 'walking' | 'wild';
  platform?: string;
  dwellTime?: number;
}

// ========== 优先队列 (最小堆) ==========
class MinHeap<T> {
  private heap: { key: number; value: T }[] = [];

  push(value: T, key: number): void {
    this.heap.push({ key, value });
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top.value;
  }

  size(): number { return this.heap.length; }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.heap[parent].key <= this.heap[idx].key) break;
      this.swap(parent, idx);
      idx = parent;
    }
  }

  private sinkDown(idx: number): void {
    const n = this.heap.length;
    while (true) {
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      let smallest = idx;
      if (left < n && this.heap[left].key < this.heap[smallest].key) smallest = left;
      if (right < n && this.heap[right].key < this.heap[smallest].key) smallest = right;
      if (smallest === idx) break;
      this.swap(smallest, idx);
      idx = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const tmp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = tmp;
  }
}

// ========== 建图 ==========
export function buildGraph(
  stations: Record<string, Station>,
  routes: Route[],
  opts: FindRouteRequest
): Record<string, Edge[]> {
  const graph: Record<string, Edge[]> = {};
  for (const id in stations) graph[id] = [];

  const avoidSet = new Set(opts.avoidStations || []);
  const ignoreLineSet = new Set((opts.ignoredLines || []).map(s => s.toLowerCase()));
  const onlyLineSet = new Set((opts.onlyLines || []).map(s => s.toLowerCase()));
  const hasOnlyLines = onlyLineSet.size > 0;

  // ---------- Step 1: 添加线路边 ----------
  for (const route of routes) {
    // 过滤交通工具类型
    if (opts.disableHighSpeed && route.type === 'train_high_speed') continue;
    if (opts.onlyLrt && route.type !== 'train_light_rail') continue;
    if (opts.disableBoat && route.type.includes('boat')) continue;

    // 过滤禁用/仅用线路
    const routeNameLower = route.name.toLowerCase();
    if (ignoreLineSet.has(routeNameLower)) continue;
    if (hasOnlyLines && !onlyLineSet.has(routeNameLower)) continue;

    const stationsOnRoute = route.stations;
    const routeStationsId = stationsOnRoute.map(s => s.id);

    for (let i = 0; i < stationsOnRoute.length; i++) {
      const from = stationsOnRoute[i];
      if (avoidSet.has(from.id)) continue;

      // 累加时间（连续区间，不逐站换乘）
      let cumulTime = 0;
      for (let j = i + 1; j < stationsOnRoute.length; j++) {
        const to = stationsOnRoute[j];
        if (avoidSet.has(to.id)) break;  // 经过禁停站则中断

        // 站间运行时间
        if (route.durations && route.durations[i] != null) {
          cumulTime += route.durations[j - 1] / 1000;
        } else {
          // 用距离/速度估算
          const s1 = stations[from.id];
          const s2 = stations[to.id];
          if (!s1 || !s2) continue;
          const dist = Math.hypot(s1.x - s2.x, s1.z - s2.z);
          cumulTime += dist / SPEED[route.type];
        }

        // 乘车边: from -> to
        const edge: Edge = {
          to: to.id,
          weight: cumulTime,
          routeId: route.id,
          routeName: route.name.split('|')[0] || route.name,
          edgeType: 'ride',
          platform: from.name,  // 站台信息
        };
        graph[from.id].push(edge);
      }
    }
  }

  // ---------- Step 2: 站内换乘边 (同一坐标点视为同站) ----------
  // 注意: Python 版通过 connections 字段定义换乘关系
  // 这里复用 connections 信息
  for (const [id, station] of Object.entries(stations)) {
    if (avoidSet.has(id)) continue;
    for (const connId of station.connections || []) {
      if (avoidSet.has(connId)) continue;
      if (!stations[connId]) continue;
      const s1 = stations[id];
      const s2 = stations[connId];
      const dist = Math.hypot(s1.x - s2.x, s1.z - s2.z);
      const t = Math.max(dist / RUNNING_SPEED, 5); // 至少5秒
      graph[id].push({
        to: connId, weight: t,
        edgeType: 'transfer',
        routeName: '站内换乘',
      });
      graph[connId].push({
        to: id, weight: t,
        edgeType: 'transfer',
        routeName: '站内换乘',
      });
    }
  }

  // ---------- Step 3: 出站换乘 (近邻站步行) ----------
  if (opts.enableWild) {
    const stationIds = Object.keys(stations);
    const positions: { id: string; x: number; z: number }[] = stationIds
      .filter(id => !avoidSet.has(id))
      .map(id => ({ id, x: stations[id].x, z: stations[id].z }));

    // 简单 O(n^2) 近邻查找（对 <5000 站的规模足够）
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i], b = positions[j];
        const dist = Math.hypot(a.x - b.x, a.z - b.z);
        if (dist > MAX_WILD_BLOCKS) continue;
        const t = dist / WILD_SPEED;
        graph[a.id].push({ to: b.id, weight: t, edgeType: 'wild', routeName: '步行' });
        graph[b.id].push({ to: a.id, weight: t, edgeType: 'wild', routeName: '步行' });
      }
    }
  }

  return graph;
}

// ========== Dijkstra 最短路径 ==========
interface DijkstraResult {
  distance: Record<string, number>;
  previous: Record<string, { from: string; edge: Edge } | null>;
}

export function dijkstra(
  graph: Record<string, Edge[]>,
  start: string,
  end: string,
  timeLimitMs: number = 30,
): DijkstraResult {
  const distance: Record<string, number> = {};
  const previous: Record<string, { from: string; edge: Edge } | null> = {};
  for (const id in graph) { distance[id] = Infinity; previous[id] = null; }
  distance[start] = 0;

  const heap = new MinHeap<string>();
  heap.push(start, 0);

  const startTime = Date.now();
  while (heap.size() > 0) {
    // CPU 超时保护
    if (Date.now() - startTime > timeLimitMs) {
      console.warn('Dijkstra timeout after', timeLimitMs, 'ms');
      break;
    }

    const current = heap.pop()!;
    if (current === end) break;
    if (distance[current] === Infinity) continue;

    for (const edge of graph[current] || []) {
      const alt = distance[current] + edge.weight;
      if (alt < distance[edge.to]) {
        distance[edge.to] = alt;
        previous[edge.to] = { from: current, edge };
        heap.push(edge.to, alt);
      }
    }
  }

  return { distance, previous };
}

// ========== 路径回溯 + 聚合 ==========
export function reconstructPath(
  stations: Record<string, Station>,
  routes: Record<string, Route>,
  previous: Record<string, { from: string; edge: Edge } | null>,
  start: string,
  end: string,
): PathSegment[] {
  if (!previous[end] && start !== end) return [];

  // 反向追踪节点序列
  const nodes: string[] = [];
  let cur: string | null = end;
  while (cur && cur !== start) {
    nodes.push(cur);
    const p = previous[cur];
    cur = p ? p.from : null;
  }
  nodes.push(start);
  nodes.reverse();

  // 聚合同线路连续段
  const segments: PathSegment[] = [];
  let currentRouteId: string | undefined = undefined;
  let segmentStartIdx = 0;

  for (let i = 1; i < nodes.length; i++) {
    const prev = previous[nodes[i]];
    const edge = prev?.edge;
    const routeId = edge?.routeId;

    // 线路变化或到换乘点，则分段
    if (routeId !== currentRouteId) {
      if (currentRouteId !== undefined && i > segmentStartIdx + 1) {
        // 提交上一段
        segments.push(makeSegment(stations, routes, nodes, previous, segmentStartIdx, i));
      } else if (currentRouteId === undefined && i > segmentStartIdx) {
        // 纯步行/换乘段
        segments.push(makeSegment(stations, routes, nodes, previous, segmentStartIdx, i));
      }
      segmentStartIdx = i - 1;
      currentRouteId = routeId;
    }
  }

  // 最后一段
  if (segmentStartIdx < nodes.length - 1) {
    segments.push(makeSegment(stations, routes, nodes, previous, segmentStartIdx, nodes.length - 1));
  }

  return segments;
}

function makeSegment(
  stations: Record<string, Station>,
  routes: Record<string, Route>,
  nodes: string[],
  previous: Record<string, { from: string; edge: Edge } | null>,
  fromIdx: number,
  toIdx: number,
): PathSegment {
  let totalTime = 0;
  let routeName = '步行';
  let route: Route | undefined;

  for (let i = fromIdx + 1; i <= toIdx; i++) {
    const edge = previous[nodes[i]]?.edge;
    if (edge) {
      totalTime += edge.weight;
      if (edge.routeName) routeName = edge.routeName;
      if (edge.routeId) route = routes[edge.routeId];
    }
  }

  return {
    from: stations[nodes[fromIdx]],
    to: stations[nodes[toIdx]],
    route,
    routeName,
    travelTime: Math.round(totalTime),
    waitingTime: 0,
    terminus: route ? (stations[route.stations[route.stations.length - 1].id]?.name || '').split('|')[0] : '',
    platform: previous[nodes[fromIdx + 1]]?.edge?.platform,
  };
}

// ========== 主寻路入口 ==========
export function findShortestRoute(
  data: { stations: Record<string, Station>; routes: Route[] },
  req: FindRouteRequest,
  timeLimitMs: number = 30,
): FindRouteResult | null {
  // 1. 起终点匹配（支持模糊匹配 - 简化版: 直接用输入作为 ID 或精确匹配名字）
  const startId = resolveStationName(data.stations, req.start);
  const endId = resolveStationName(data.stations, req.end);
  if (!startId || !endId) return null;
  if (startId === endId) return null;

  // 2. 建图
  const routesMap: Record<string, Route> = {};
  for (const r of data.routes) routesMap[r.id] = r;

  const graph = buildGraph(data.stations, data.routes, req);

  // 3. Dijkstra
  const { distance, previous } = dijkstra(graph, startId, endId, timeLimitMs);
  if (!isFinite(distance[endId])) return null;

  // 4. 回溯
  const segments = reconstructPath(data.stations, routesMap, previous, startId, endId);
  const totalStations: Station[] = segments.map(s => s.from);
  if (segments.length > 0) totalStations.push(segments[segments.length - 1].to);

  const totalTime = Math.round(distance[endId]);
  const ridingTime = segments.reduce((sum, s) => sum + s.travelTime, 0);

  return {
    totalTime,
    totalStations,
    segments,
    ridingTime,
    waitingTime: Math.max(0, totalTime - ridingTime),
    transfers: Math.max(0, segments.filter(s => s.route).length - 1),
  };
}

// ========== 车站名解析（支持中文|英文，以及模糊匹配）==========
export function resolveStationName(
  stations: Record<string, Station>,
  query: string,
): string | null {
  if (!query) return null;
  const q = query.trim().toLowerCase();

  // 精确匹配 ID
  if (stations[q]) return q;

  // 精确匹配全名
  for (const [id, s] of Object.entries(stations)) {
    if (s.name.toLowerCase() === q) return id;
    const parts = s.name.split('|');
    for (const p of parts) {
      if (p.trim().toLowerCase() === q) return id;
    }
  }

  // 模糊匹配 (包含)
  for (const [id, s] of Object.entries(stations)) {
    if (s.name.toLowerCase().includes(q)) return id;
    const parts = s.name.split('|');
    for (const p of parts) {
      if (p.trim().toLowerCase().includes(q)) return id;
    }
  }

  // 前 N 个字符匹配
  for (const [id, s] of Object.entries(stations)) {
    const cn = s.chineseName || s.name.split('|')[0] || '';
    if (cn && cn.includes(query)) return id;
  }

  return null;
}
