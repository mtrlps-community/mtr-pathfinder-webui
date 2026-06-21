/**
 * MTR Pathfinder - 纯 Workers 版本的主入口
 * 
 * 功能:
 *   - 提供 REST API 给前端使用
 *   - 从 Cloudflare KV 读取预先生成的车站/线路数据
 *   - 使用 TypeScript 版 Dijkstra 实现寻路
 *   - 返回 JSON 格式结果（不生成图片，前端自行渲染）
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { cache } from 'hono/cache';
import { findShortestRoute, resolveStationName } from './pathfinder';
import type { Station, Route, FindRouteRequest } from './types';

type Bindings = {
  MTR_DATA: KVNamespace;
  MAX_PATH_TIME_MS: string;
  DATA_VERSION: string;
};

type CachedData = {
  stations: Record<string, Station>;
  routes: Route[];
  stationIndex: Record<string, string>;   // 小写名称 -> ID 索引
  updatedAt: number;
};

const app = new Hono<{ Bindings: Bindings }>();

// ========== 中间件 ==========
app.use('*', cors());

// ========== 数据加载（带内存缓存，避免每次 KV 读取）==========
const DATA_CACHE: { key?: string; data?: CachedData; time?: number } = {};

async function loadData(env: Bindings): Promise<CachedData> {
  const key = `data:${env.DATA_VERSION || 'v1'}`;
  const now = Date.now();

  // 内存缓存（1小时内有效，利用 Workers 的 per-isolate 内存）
  if (DATA_CACHE.key === key && DATA_CACHE.data && DATA_CACHE.time && now - DATA_CACHE.time < 3600_000) {
    return DATA_CACHE.data;
  }

  // 从 KV 加载
  const raw = await env.MTR_DATA.get(key, { type: 'json' });
  if (!raw) {
    throw new Error('数据未初始化，请先运行 npm run data:upload 将数据上传到 KV');
  }

  const parsed = raw as CachedData;

  // 建立名称索引加速后续查询
  if (!parsed.stationIndex) {
    parsed.stationIndex = {};
    for (const [id, station] of Object.entries(parsed.stations)) {
      const lowerName = station.name.toLowerCase();
      parsed.stationIndex[lowerName] = id;
      for (const part of station.name.split('|')) {
        const t = part.trim().toLowerCase();
        if (t) parsed.stationIndex[t] = id;
      }
    }
  }

  DATA_CACHE.key = key;
  DATA_CACHE.data = parsed;
  DATA_CACHE.time = now;
  return parsed;
}

// ========== API: 健康检查 ==========
app.get('/', async (c) => {
  const data = await loadData(c.env);
  return c.json({
    ok: true,
    service: 'MTR Pathfinder',
    dataVersion: c.env.DATA_VERSION,
    stationCount: Object.keys(data.stations).length,
    routeCount: data.routes.length,
    updatedAt: data.updatedAt,
  });
});

// ========== API: 车站搜索 ==========
app.get('/api/search_stations', cache({
  cacheName: 'mtr-search',
  cacheControl: 'max-age=3600',
}), async (c) => {
  const q = c.req.query('q')?.toLowerCase().trim();
  if (!q) return c.json([]);

  const data = await loadData(c.env);

  // 精确匹配优先
  const results: string[] = [];
  const seen = new Set<string>();

  for (const [id, station] of Object.entries(data.stations)) {
    const cn = station.chineseName || station.name.split('|')[0] || '';
    const en = station.englishName || station.name.split('|')[1] || '';
    if (
      station.name.toLowerCase().includes(q) ||
      cn.toLowerCase().includes(q) ||
      en.toLowerCase().includes(q)
    ) {
      if (!seen.has(station.name)) {
        results.push(station.name);
        seen.add(station.name);
        if (results.length >= 20) break;
      }
    }
  }

  return c.json(results);
});

// ========== API: 车站信息 ==========
app.get('/api/stations', cache({
  cacheName: 'mtr-stations',
  cacheControl: 'max-age=86400',
}), async (c) => {
  const data = await loadData(c.env);
  const stations = Object.values(data.stations).map(s => ({
    id: s.id,
    name: s.name,
    chineseName: s.chineseName,
    englishName: s.englishName,
  }));
  return c.json(stations);
});

app.get('/api/stations/:id', async (c) => {
  const data = await loadData(c.env);
  const id = c.req.param('id');
  const station = data.stations[id];
  if (!station) return c.json({ error: '车站不存在' }, 404);

  // 查找经过此站的线路
  const routesOnStation = data.routes
    .filter(r => r.stations.some(s => s.id === id))
    .map(r => ({
      id: r.id,
      name: r.name.split('|')[0],
      type: r.type,
    }));

  return c.json({
    ...station,
    routes: routesOnStation,
  });
});

// ========== API: 线路信息 ==========
app.get('/api/routes', cache({
  cacheName: 'mtr-routes',
  cacheControl: 'max-age=86400',
}), async (c) => {
  const data = await loadData(c.env);
  const routes = data.routes.map(r => ({
    id: r.id,
    name: r.name.split('|')[0] || r.name,
    type: r.type,
    color: '#' + r.color.toString(16).padStart(6, '0'),
    stationCount: r.stations.length,
  }));
  return c.json(routes);
});

app.get('/api/routes/:id', async (c) => {
  const data = await loadData(c.env);
  const id = c.req.param('id');
  const route = data.routes.find(r => r.id === id);
  if (!route) return c.json({ error: '线路不存在' }, 404);

  const stationDetails = route.stations.map(s => {
    const st = data.stations[s.id];
    return {
      id: s.id,
      name: s.name,
      fullName: st?.name,
      platform: s.platform,
      dwellTime: s.dwellTime,
    };
  });

  return c.json({
    id: route.id,
    name: route.name,
    type: route.type,
    color: '#' + route.color.toString(16).padStart(6, '0'),
    stations: stationDetails,
    durations: route.durations,
    totalDuration: route.durations.reduce((a, b) => a + b, 0) / 1000,
  });
});

// ========== API: 寻路（核心）==========
app.post('/api/find_route', async (c) => {
  try {
    const body = await c.req.json<FindRouteRequest & { start: string; end: string }>();
    if (!body.start || !body.end) {
      return c.json({ error: '缺少起点/终点' }, 400);
    }

    const data = await loadData(c.env);

    // 解析车站名
    const startId = resolveStationName(data.stations, body.start);
    const endId = resolveStationName(data.stations, body.end);

    if (!startId) return c.json({ error: '找不到起点站' }, 400);
    if (!endId) return c.json({ error: '找不到终点站' }, 400);
    if (startId === endId) return c.json({ error: '起点与终点相同' }, 400);

    const result = findShortestRoute(
      data,
      {
        ...body,
        start: startId,
        end: endId,
      },
      Number(c.env.MAX_PATH_TIME_MS || 30),
    );

    if (!result) return c.json({ error: '找不到可行路线' }, 400);

    // 格式化输出（保持与 Python 版兼容的字段）
    const stationNames = result.totalStations.map(s => s.name);
    const formattedSegments = result.segments.map(s => ({
      from: s.from.name,
      to: s.to.name,
      route: s.routeName,
      routeColor: s.route ? '#' + s.route.color.toString(16).padStart(6, '0') : null,
      routeType: s.route?.type || 'walk',
      travelTime: s.travelTime,
      terminus: s.terminus,
      platform: s.platform,
    }));

    return c.json({
      result: {
        totalTime: result.totalTime,
        stationNames,
        segments: formattedSegments,
        ridingTime: result.ridingTime,
        waitingTime: result.waitingTime,
        transfers: result.transfers,
      },
      algorithm: body.algorithm || 'theory',
      engine: 'typescript-worker',
    });
  } catch (error) {
    console.error('寻路错误:', error);
    return c.json({ error: '寻路计算失败', detail: String(error) }, 500);
  }
});

// ========== API: 数据版本信息 ==========
app.get('/api/meta', cache({
  cacheName: 'mtr-meta',
  cacheControl: 'max-age=3600',
}), async (c) => {
  const data = await loadData(c.env);
  return c.json({
    dataVersion: c.env.DATA_VERSION,
    stationCount: Object.keys(data.stations).length,
    routeCount: data.routes.length,
    updatedAt: data.updatedAt,
    updatedAtHuman: new Date(data.updatedAt).toISOString(),
  });
});

// ========== 管理 API ==========
app.post('/api/admin/clear_cache', async (c) => {
  DATA_CACHE.key = undefined;
  DATA_CACHE.data = undefined;
  DATA_CACHE.time = undefined;
  return c.json({ success: true });
});

app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ error: err.message }, 500);
});

export default app;
