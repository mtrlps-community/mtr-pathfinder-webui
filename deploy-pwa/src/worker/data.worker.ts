/**
 * Web Worker: 数据加载 + 路径规划
 *
 * 所有计算密集型任务都在这里执行，不阻塞主线程 UI。
 * 使用 Comlink 暴露函数给主线程调用。
 */

import type {
  Station,
  Platform,
  Route,
  Segment,
  TransitData,
  RawData,
  RawStation,
  RawRoute,
  RawPlatform,
  TransportType,
  PathMode,
  PathResult,
  PathStep,
  ProgressCallback,
} from '../definitions/worker';

// ========================================
// 运行时数据（Worker 内部，不直接暴露给主线程）
// ========================================

const workerData: TransitData = {
  stations: [],
  platforms: [],
  routes: [],
  segments: [],
};

// 索引：id → 数组索引（O(1) 查找）
const index: {
  stations: Map<string, number>;
  platforms: Map<string, number>;
  routes: Map<string, number>;
  segments: Map<string, number>;
} = {
  stations: new Map(),
  platforms: new Map(),
  routes: new Map(),
  segments: new Map(),
};

// 路径规划计算缓存（每个 segment 一个 calc 对象）
interface Calc {
  wait: number;          // 等待时间
  prev: number;          // 前一个 segment 索引
  next: number;          // 暂未使用，保持兼容
  prev_score: number;    // 到达此 segment 起点的累计评分
  next_score: number;    // 到达此 segment 终点的累计评分
}

const calcs: Calc[] = [];

// ========================================
// 常量
// ========================================

const LANG_PREFERRED = 0;           // 默认中文
const WALK_SPEED = 4.137 / 20;      // bloc/tick（步行速度）
const WAIT_DELAY = 20 * 90;         // 站台等待时间 (~60s)

// ========================================
// 工具函数
// ========================================

/** 十进制颜色 → #rrggbb */
function toColor(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** 获取多语言名称的首选语言版本 */
function locale(text: string | string[] | undefined): string {
  if (text === undefined) return '';
  if (typeof text === 'string') return text;
  return text[Math.min(LANG_PREFERRED, text.length - 1)];
}

/** 按名称排序（方便展示） */
function byLocaleName(a: Station | Route, b: Station | Route): number {
  return locale(a.name).localeCompare(locale(b.name));
}

/** 深冻结（防止运行时修改） */
function deepFreeze(obj: unknown): void {
  if (typeof obj !== 'object' || obj === null) return;
  Object.freeze(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) deepFreeze(item);
  } else {
    for (const value of Object.values(obj as Record<string, unknown>)) {
      deepFreeze(value);
    }
  }
}

// ========================================
// 核心：数据加载
// ========================================

/**
 * 从 URL 或对象加载 MTR 数据，并构建 segment 图
 *
 * @param source URL 字符串，或已解析的 JSON 对象
 * @param progressCb 进度回调 [0-2, 消息]，用于 UI 显示进度
 */
export async function load(
  source: string | object | RawData,
  progressCb: ProgressCallback = () => {},
): Promise<void> {
  try {
    // 步骤 1: 获取原始数据
    const raw = await resolveSource(source);
    progressCb([0.2, '数据已获取']);

    // 步骤 2: 转换 stations / routes / platforms
    transformAllDimensions(raw);
    progressCb([1.0, '数据结构转换完成']);

    // 步骤 3: 构建 segment 图
    buildSegments();
    progressCb([1.6, '路径网络构建完成']);

    // 步骤 4: 索引 + 冻结
    buildIndexesAndFreeze();
    resetCalcScore();
    progressCb([2.0, '准备就绪！']);
  } catch (e) {
    console.error('数据加载失败:', e);
    progressCb([-1, (e as Error).message]);
    throw e;
  }
}

/** 解析数据源 */
async function resolveSource(source: string | object): Promise<RawData> {
  if (typeof source === 'string') {
    // URL 模式：fetch
    const res = await fetch(source);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json() as Promise<RawData>;
  }
  // 对象模式：直接使用（如果是单维度，包一层数组）
  const obj = source as any;
  if (Array.isArray(obj)) return obj;
  if (obj.stations || obj.routes) {
    return [{
      dim_id: obj.dim_id || 'overworld',
      stations: obj.stations || {},
      routes: obj.routes || {},
      positions: obj.positions || {},
    }];
  }
  return obj;
}

/** 转换所有维度 */
function transformAllDimensions(raw: RawData): void {
  workerData.stations = [];
  workerData.platforms = [];
  workerData.routes = [];
  workerData.segments = [];

  for (const dim of raw) {
    // Stations
    for (const [id, st] of Object.entries(dim.stations)) {
      const station: Station = {
        index: workerData.stations.length,
        id,
        dim: dim.dim_id,
        name: st.name.split('|'),
        pattern: st.name.toLowerCase(),
        color: toColor(st.color),
        pos: { x: st.x, z: st.z },
        zone: st.zone,
        connections: [],
        platforms: [],
        routes: [],
        next: [],
        prev: [],
      };
      workerData.stations.push(station);
      index.stations.set(id, station.index);
    }

    // Routes
    for (const [id, rt] of Object.entries(dim.routes)) {
      const [namePart = '', direction = ''] = rt.name.split('||');
      const route: Route = {
        index: workerData.routes.length,
        id: `${rt.color}`,
        dim: dim.dim_id,
        name: namePart.split('|'),
        number: (rt.number || '').split('|'),
        color: toColor(rt.color),
        type: rt.type as TransportType,
        circular: rt.circular || false,
        stations: [],
        platforms: [],
        durations: rt.durations || [],
        densities: rt.densities || [],
        pattern: namePart.toLowerCase(),
      };
      workerData.routes.push(route);
      index.routes.set(id, route.index);
    }

    // Platforms (从 route.stations 派生，MTR 游戏中 station_id = route_station)
    // 注意：实际的 positions 数据（如果有）比推测更准确
    for (const [id, pos] of Object.entries(dim.positions || {})) {
      const stationId = id.split('_')[0];
      const platform: Platform = {
        index: workerData.platforms.length,
        id,
        dim: dim.dim_id,
        station: index.stations.get(stationId) ?? -1,
        routes: [],
        pos: { x: pos.x, z: pos.y },
        vertical: pos.vertical,
        next: [],
        prev: [],
      };
      if (platform.station !== -1) {
        workerData.platforms.push(platform);
        index.platforms.set(id, platform.index);
      }
    }
  }

  // 连接 route → stations/platforms
  for (const route of workerData.routes) {
    // 从 route.stations (原始 ID 列表) 映射到 station 索引
    // 同时创建对应的 platform
    const rawStations: string[] = (raw as any).find((d: any) => d.dim_id === route.dim)?.routes[route.id]?.stations || [];
    // 更简单的方式：直接从 rawStations 构建
    // 但我们已经丢失了这个关联，所以用 station name 反向匹配
    // 实际上需要在 transform routes 的同时保存 stations 列表
  }

  // 重新处理：更简单直接的 route.stations 填充
  for (const dim of raw) {
    for (const [routeId, rt] of Object.entries(dim.routes)) {
      const route = workerData.routes[index.routes.get(routeId)!];
      if (!route) continue;

      // 填充 station 索引
      const stationIdxs: number[] = [];
      const platformIdxs: number[] = [];

      for (let i = 0; i < rt.stations.length; i++) {
        const stId = rt.stations[i];
        const stIdx = index.stations.get(stId);
        if (stIdx === undefined) continue;
        stationIdxs.push(stIdx);

        // 创建/查找对应的 platform： stationId_index-in-route
        const plId = `${stId}_${i}`;
        let plIdx = index.platforms.get(plId);
        if (plIdx === undefined) {
          // 创建一个 synthetic platform
          const st = workerData.stations[stIdx];
          plIdx = workerData.platforms.length;
          const platform: Platform = {
            index: plIdx,
            id: plId,
            dim: dim.dim_id,
            station: stIdx,
            routes: [],
            pos: { ...st.pos },
            vertical: false,
            next: [],
            prev: [],
          };
          workerData.platforms.push(platform);
          index.platforms.set(plId, plIdx);
          st.platforms.push(plIdx);
        }
        platformIdxs.push(plIdx);
        // 记录此线路经过该平台
        if (plIdx !== undefined) {
          const pl = workerData.platforms[plIdx];
          if (!pl.routes.includes(route.index)) pl.routes.push(route.index);
        }
      }

      route.stations = stationIdxs;
      route.platforms = platformIdxs;

      // 如果没有提供 durations，根据坐标计算
      if (route.durations.length === 0 || route.durations.length !== stationIdxs.length - 1) {
        const durs: number[] = [];
        for (let i = 0; i < route.stations.length - 1; i++) {
          const st1 = workerData.stations[route.stations[i]];
          const st2 = workerData.stations[route.stations[i + 1]];
          const dist = Math.hypot(st1.pos.x - st2.pos.x, st1.pos.z - st2.pos.z);
          durs.push(dist / WALK_SPEED);
        }
        route.durations = durs;
      }

      // 反向映射：stations → routes
      for (const stIdx of route.stations) {
        const st = workerData.stations[stIdx];
        if (!st.routes.includes(route.index)) st.routes.push(route.index);
      }
    }
  }

  // 处理 connections（字符串 → station 索引）
  for (const dim of raw) {
    for (const [stId, stRaw] of Object.entries(dim.stations)) {
      const st = workerData.stations[index.stations.get(stId)!];
      if (!st || !stRaw.connections) continue;
      for (const connId of stRaw.connections) {
        const connIdx = index.stations.get(connId);
        if (connIdx !== undefined && !st.connections.includes(connIdx)) {
          st.connections.push(connIdx);
        }
      }
    }
  }

  // 排序：便于搜索和展示
  workerData.stations.sort((a, b) => byLocaleName(a, b));
  workerData.routes.sort((a, b) => byLocaleName(a, b));

  // 重新索引（排序后索引变化）
  workerData.stations.forEach((st, i) => {
    st.index = i;
    index.stations.set(st.id, i);
  });
  workerData.routes.forEach((rt, i) => {
    rt.index = i;
  });
}

/** 构建 segments（图的边） */
function buildSegments(): void {
  // 清空
  workerData.segments = [];

  // === 1. 线路段：相邻站台之间 ===
  for (const route of workerData.routes) {
    for (let i = 1; i < route.platforms.length; i++) {
      const fromPl = workerData.platforms[route.platforms[i - 1]];
      const toPl = workerData.platforms[route.platforms[i]];
      if (!fromPl || !toPl) continue;

      const fromSt = workerData.stations[fromPl.station];
      const toSt = workerData.stations[toPl.station];
      const distance = Math.hypot(
        fromPl.pos.x - toPl.pos.x,
        fromPl.pos.z - toPl.pos.z,
      ) || Math.hypot(fromSt.pos.x - toSt.pos.x, fromSt.pos.z - toSt.pos.z);

      const duration = route.durations[i - 1] || distance / WALK_SPEED;

      const segment: Segment = {
        index: workerData.segments.length,
        route: { type: route.type, index: route.index },
        from: { type: 'platform', index: fromPl.index },
        to: { type: 'platform', index: toPl.index },
        distance: Math.ceil(distance),
        duration: Math.ceil(duration),
        prev: [],
        next: [],
      };
      workerData.segments.push(segment);
    }
  }

  // === 2. 平台段：站台 ↔ 所属车站（步行/上下车）===
  for (const platform of workerData.platforms) {
    const station = workerData.stations[platform.station];
    if (!station) continue;
    const distance = Math.hypot(
      platform.pos.x - station.pos.x,
      platform.pos.z - station.pos.z,
    ) || 5;
    const duration = (distance * 2) / WALK_SPEED;

    // 到站：platform → station（下车）
    workerData.segments.push({
      index: workerData.segments.length,
      route: { type: 'walk', index: -1 },
      from: { type: 'platform', index: platform.index },
      to: { type: 'station', index: station.index },
      distance: Math.ceil(distance),
      duration: Math.ceil(duration),
      prev: [],
      next: [],
    });

    // 出站：station → platform（上车，含等待时间）
    workerData.segments.push({
      index: workerData.segments.length,
      route: { type: 'walk', index: -1 },
      from: { type: 'station', index: station.index },
      to: { type: 'platform', index: platform.index },
      distance: Math.ceil(distance),
      duration: Math.ceil(duration),
      wait: WAIT_DELAY,
      prev: [],
      next: [],
    });
  }

  // === 3. 车站间步行段：connections（跨站换乘）===
  for (const station of workerData.stations) {
    for (const connIdx of station.connections) {
      if (connIdx === station.index) continue;
      const other = workerData.stations[connIdx];
      if (!other) continue;
      const distance = Math.hypot(
        station.pos.x - other.pos.x,
        station.pos.z - other.pos.z,
      ) || 30;
      const duration = (distance * 2) / WALK_SPEED;

      workerData.segments.push({
        index: workerData.segments.length,
        route: { type: 'walk', index: -1 },
        from: { type: 'station', index: station.index },
        to: { type: 'station', index: connIdx },
        distance: Math.ceil(distance),
        duration: Math.ceil(duration),
        prev: [],
        next: [],
      });
    }
  }

  // === 4. 连接 segments：构建 prev / next 关系 ===
  // 每个 thing (station/platform) 的 next/prev 要包含关联的 segments
  for (const seg of workerData.segments) {
    // 起点 (from)：这是它的"出站" segment
    const fromType = seg.from.type;
    const fromIdx = seg.from.index;
    const fromThing = fromType === 'station'
      ? workerData.stations[fromIdx]
      : workerData.platforms[fromIdx];

    // 终点 (to)：这是它的"入站" segment
    const toType = seg.to.type;
    const toIdx = seg.to.index;
    const toThing = toType === 'station'
      ? workerData.stations[toIdx]
      : workerData.platforms[toIdx];

    if (fromThing) fromThing.next.push(seg.index);
    if (toThing) toThing.prev.push(seg.index);
  }

  // 连接 segments 之间的关系 (prev 和 next)
  for (const seg of workerData.segments) {
    // 找到起点的所有入站 segments（它们的下一个可能是本 segment）
    const fromType = seg.from.type;
    const fromIdx = seg.from.index;
    const fromThing = fromType === 'station'
      ? workerData.stations[fromIdx]
      : workerData.platforms[fromIdx];
    // fromThing 的 prev 中，终点 = fromThing 的 segments 是本 segment 的 prev
    if (fromThing) {
      seg.prev = fromThing.prev.filter((id) => id !== seg.index);
    }

    // 找到终点的所有出站 segments（本 segment 的后续）
    const toType = seg.to.type;
    const toIdx = seg.to.index;
    const toThing = toType === 'station'
      ? workerData.stations[toIdx]
      : workerData.platforms[toIdx];
    if (toThing) {
      seg.next = toThing.next.filter((id) => id !== seg.index);
    }
  }
}

/** 建立索引 + 冻结 */
function buildIndexesAndFreeze(): void {
  workerData.segments.forEach((seg, i) => {
    seg.index = i;
    index.segments.set(`${seg.from.type}:${seg.from.index}-${seg.to.type}:${seg.to.index}`, i);
  });
  deepFreeze(workerData.stations);
  deepFreeze(workerData.platforms);
  deepFreeze(workerData.routes);
  deepFreeze(workerData.segments);
}

// ========================================
// 核心：路径规划
// ========================================

/** 评分函数（不同模式下 segment 的权重） */
const scoringFns = {
  routes: (calc: Calc, segment: Segment, prevRouteIdx: number) => {
    const routeIdx = segment.route.index;
    const isTransfer = routeIdx === -1 || routeIdx !== prevRouteIdx;
    const inc = isTransfer ? 100 : 1; // 换乘成本高
    return calc.prev_score + inc;
  },
  distance: (calc: Calc, segment: Segment) => calc.prev_score + segment.distance,
  duration: (calc: Calc, segment: Segment) => {
    return calc.prev_score + segment.duration + (calc.wait || 0);
  },
};

/** 重置评分缓存（每次计算新路径前调用） */
function resetCalcScore(): void {
  const expected = workerData.segments.length;
  if (calcs.length < expected) calcs.length = expected;
  for (let i = 0; i < expected; i++) {
    calcs[i] ??= { wait: 0, prev: -1, next: -1, prev_score: Infinity, next_score: Infinity };
    calcs[i].wait = 0;
    calcs[i].prev = -1;
    calcs[i].next = -1;
    calcs[i].prev_score = Infinity;
    calcs[i].next_score = Infinity;
  }
}

/**
 * 计算 fromStation → toStation 的最优路径
 * 使用 segment-based Dijkstra 算法
 */
function calcPathGen(
  fromStationIdx: number,
  toStationIdx: number,
  mode: PathMode,
): number[] {
  resetCalcScore();

  const fromStation = workerData.stations[fromStationIdx];
  const toStation = workerData.stations[toStationIdx];
  if (!fromStation || !toStation) return [];

  // 起点：从 fromStation 的所有出站 segment 开始
  // 使用 Set 作为待处理队列（Dijkstra 的简化版，对非负权重有效）
  // 注：如果是大规模网络 (>1000 segments)，应改用优先队列
  const pending = new Set<number>(fromStation.next);

  // 初始化起点 segment 评分
  for (const segIdx of fromStation.next) {
    if (segIdx >= calcs.length) continue;
    calcs[segIdx].prev = -1;         // -1 表示起点
    calcs[segIdx].prev_score = 0;
  }

  // 记忆上一条线路（用于 routes 模式的换乘检测）
  // 为简化，用 segment route 索引作为判断依据

  // 主循环：遍历所有可达 segment
  for (const segIdx of pending) {
    const segment = workerData.segments[segIdx];
    const calc = calcs[segIdx];
    if (calc.prev_score === Infinity) continue;

    calc.wait = segment.wait || 0;
    // 根据模式计算到达终点的评分
    if (mode === 'routes') {
      // 找到上一个 segment 以检测是否换乘
      const prevSeg = calc.prev >= 0 ? workerData.segments[calc.prev] : null;
      const prevRouteIdx = prevSeg?.route?.index ?? -1;
      calc.next_score = scoringFns.routes(calc, segment, prevRouteIdx);
    } else if (mode === 'distance') {
      calc.next_score = scoringFns.distance(calc, segment);
    } else {
      calc.next_score = scoringFns.duration(calc, segment);
    }

    // 扩展邻居
    for (const nextIdx of segment.next) {
      if (nextIdx >= calcs.length) continue;
      const nextCalc = calcs[nextIdx];
      if (nextCalc.prev_score > calc.next_score) {
        nextCalc.prev_score = calc.next_score;
        nextCalc.prev = segIdx;
        pending.add(nextIdx);
      }
    }
    pending.delete(segIdx);
  }

  // 回溯：从终点反向找到最佳路径
  // 终点：toStation.prev 中评分最低的那个
  let current: number | undefined = toStation.prev
    .filter((i) => i < calcs.length)
    .sort((a, b) => calcs[a].next_score - calcs[b].next_score)[0];

  const chain: number[] = [];
  let safety = 10000;
  while (current !== undefined && current !== -1 && safety-- > 0) {
    chain.push(current);
    current = calcs[current]?.prev;
  }
  chain.reverse();
  return chain;
}

/**
 * 计算路径（主入口）
 *
 * @param stationNames 车站名称序列（至少 2 个：起、终）
 * @param mode 评分模式：routes（最少换乘）/ distance（最短距离）/ duration（最短时间）
 */
export function calcPath(
  stationNames: string[],
  mode: PathMode = 'distance',
): PathResult | null {
  // 解析车站名 → station 索引
  const stationIdxList = stationNames
    .map((name) => findStationByName(name))
    .filter((i): i is number => i !== -1);

  if (stationIdxList.length < 2) {
    return null;
  }

  // 分段计算：[A, B, C] → 先算 A→B，再算 B→C
  const parts: Array<[number, number]> = [];
  for (let i = 1; i < stationIdxList.length; i++) {
    parts.push([stationIdxList[i - 1], stationIdxList[i]]);
  }

  const segmentChains = parts.map(([from, to]) => calcPathGen(from, to, mode));

  // 检查是否有任何一段无解
  if (segmentChains.some((c) => c.length === 0)) {
    return null;
  }

  return beautifyPath(segmentChains.flat(), stationIdxList);
}

/** 通过名称查找车站（支持模糊匹配） */
function findStationByName(name: string): number {
  const lower = name.toLowerCase().trim();
  // 精确匹配
  for (const st of workerData.stations) {
    if (st.name.some((n) => n.toLowerCase() === lower)) return st.index;
  }
  // 模糊匹配
  for (const st of workerData.stations) {
    if (st.pattern.includes(lower)) return st.index;
  }
  for (const st of workerData.stations) {
    if (st.name.some((n) => n.toLowerCase().includes(lower))) return st.index;
  }
  return -1;
}

/** 将 segment 链转换为可读性强的步骤 */
function beautifyPath(segChain: number[], stationIdxList: number[]): PathResult {
  const steps: PathStep[] = [];
  let totalDistance = 0;
  let totalDuration = 0;
  let transfers = 0;
  const stationNames: string[] = [];

  if (segChain.length === 0) {
    return { steps: [], totalDistance: 0, totalDuration: 0, transfers: 0, stationCount: 0, stationNames: [] };
  }

  // 聚合相邻的同线路 segment 为一个 step
  let currentRouteIdx: number | null = null;
  let currentStep: PathStep | null = null;
  let firstStationName = '';

  for (const segIdx of segChain) {
    const segment = workerData.segments[segIdx];
    if (!segment) continue;

    totalDistance += segment.distance;
    totalDuration += segment.duration;

    // 步行 segment（站内换乘、跨站换乘）
    if (segment.route.index === -1) {
      // 如果有正在聚合的 ride step，先保存它
      if (currentStep) {
        steps.push(currentStep);
        currentStep = null;
        currentRouteIdx = null;
      }

      const fromThing = segment.from.type === 'station'
        ? workerData.stations[segment.from.index]
        : workerData.platforms[segment.from.index];
      const toThing = segment.to.type === 'station'
        ? workerData.stations[segment.to.index]
        : workerData.platforms[segment.to.index];

      // 只在 station ↔ station 边界生成换乘 step（忽略 platform 中间段）
      if (segment.from.type === 'station' && segment.to.type === 'station') {
        const fromSt = workerData.stations[segment.from.index];
        const toSt = workerData.stations[segment.to.index];
        steps.push({
          type: 'walk',
          fromStation: { index: fromSt.index, name: locale(fromSt.name) },
          toStation: { index: toSt.index, name: locale(toSt.name) },
          distance: segment.distance,
          duration: segment.duration,
          segments: [segIdx],
        });
        stationNames.push(locale(toSt.name));
        transfers++;
      }
      continue;
    }

    // 乘车 segment
    const route = workerData.routes[segment.route.index];
    if (!route) continue;

    // 获取起终点车站
    const fromPl = segment.from.type === 'platform'
      ? workerData.platforms[segment.from.index]
      : null;
    const toPl = segment.to.type === 'platform'
      ? workerData.platforms[segment.to.index]
      : null;

    const fromSt = fromPl ? workerData.stations[fromPl.station] : null;
    const toSt = toPl ? workerData.stations[toPl.station] : null;

    if (!fromSt || !toSt) continue;

    // 新线路开始 / 正在聚合同一线路
    if (currentRouteIdx === segment.route.index && currentStep) {
      // 继续聚合
      currentStep.toStation = { index: toSt.index, name: locale(toSt.name) };
      currentStep.toPlatform = toPl ? { index: toPl.index, id: toPl.id } : undefined;
      currentStep.distance += segment.distance;
      currentStep.duration += segment.duration;
      currentStep.segments.push(segIdx);
    } else {
      // 新 step 开始
      if (currentStep) {
        steps.push(currentStep);
        transfers++;
      }
      currentRouteIdx = segment.route.index;
      currentStep = {
        type: 'ride',
        route: { index: route.index, name: locale(route.name), color: route.color },
        fromStation: { index: fromSt.index, name: locale(fromSt.name) },
        toStation: { index: toSt.index, name: locale(toSt.name) },
        fromPlatform: fromPl ? { index: fromPl.index, id: fromPl.id } : undefined,
        toPlatform: toPl ? { index: toPl.index, id: toPl.id } : undefined,
        distance: segment.distance,
        duration: segment.duration,
        segments: [segIdx],
      };
      if (steps.length === 0) firstStationName = locale(fromSt.name);
      stationNames.push(locale(toSt.name));
    }
  }

  // 保存最后一个 step
  if (currentStep) steps.push(currentStep);

  return {
    steps,
    totalDistance: Math.ceil(totalDistance),
    totalDuration: Math.ceil(totalDuration / 20),     // ticks → 秒（约）
    transfers,
    stationCount: stationIdxList.length,
    stationNames: [firstStationName, ...stationNames].filter(Boolean),
  };
}

// ========================================
// 辅助 API（给 UI 用）
// ========================================

export function getData(): TransitData {
  return workerData;
}

export function searchStations(query: string): Array<{ index: number; id: string; name: string }> {
  if (!query || query.trim().length < 1) return [];
  const q = query.toLowerCase().trim();
  const results: Array<{ index: number; id: string; name: string }> = [];

  for (const st of workerData.stations) {
    if (st.pattern.includes(q) || st.name.some((n) => n.toLowerCase().includes(q))) {
      results.push({ index: st.index, id: st.id, name: locale(st.name) });
      if (results.length >= 20) break;
    }
  }
  return results;
}

export function getStationById(id: string): Station | null {
  const idx = index.stations.get(id);
  return idx !== undefined ? workerData.stations[idx] : null;
}

export function getRoutesForStation(stationIdx: number): Route[] {
  const st = workerData.stations[stationIdx];
  if (!st) return [];
  return st.routes.map((r) => workerData.routes[r]).filter(Boolean);
}

export function getAllStations(): Array<{ index: number; id: string; name: string; color: string }> {
  return workerData.stations.map((st) => ({
    index: st.index,
    id: st.id,
    name: locale(st.name),
    color: st.color,
  }));
}

export function getAllRoutes(): Array<{
  index: number;
  id: string;
  name: string;
  color: string;
  type: TransportType;
  stationCount: number;
}> {
  return workerData.routes.map((rt) => ({
    index: rt.index,
    id: rt.id,
    name: locale(rt.name),
    color: rt.color,
    type: rt.type,
    stationCount: rt.stations.length,
  }));
}

export function getRouteDetails(routeIdx: number): {
  name: string;
  color: string;
  type: TransportType;
  stations: Array<{ index: number; id: string; name: string }>;
  totalDuration: number;
} | null {
  const route = workerData.routes[routeIdx];
  if (!route) return null;
  return {
    name: locale(route.name),
    color: route.color,
    type: route.type,
    stations: route.stations
      .map((idx) => {
        const st = workerData.stations[idx];
        return st ? { index: st.index, id: st.id, name: locale(st.name) } : null;
      })
      .filter(Boolean) as Array<{ index: number; id: string; name: string }>,
    totalDuration: route.durations.reduce((a, b) => a + b, 0),
  };
}

export function stats(): {
  stations: number;
  platforms: number;
  routes: number;
  segments: number;
} {
  return {
    stations: workerData.stations.length,
    platforms: workerData.platforms.length,
    routes: workerData.routes.length,
    segments: workerData.segments.length,
  };
}
