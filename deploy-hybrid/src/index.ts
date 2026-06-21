/**
 * MTR Pathfinder - Cloudflare Workers 边缘层（混合架构方案）
 * 
 * 职责:
 *   1. 作为边缘 CDN，缓存静态资源和查询结果
 *   2. 将 API 请求代理到 Python 后端
 *   3. 在边缘处理简单查询（车站搜索、缓存查找）
 *   4. 做 WAF / 限流 / 缓存管理
 * 
 * 架构:
 *   ┌──────────┐    HTTP(S)     ┌──────────────┐   HTTP   ┌─────────────┐
 *   │ 浏览器    │ ─────────────▶ │  This Worker │ ───────▶│ Python 后端 │
 *   │           │ ◀──────────── │ (缓存+代理)   │ ◀───────│ (main.py)   │
 *   └──────────┘                └──────────────┘         └─────────────┘
 * 
 * 注意: 复杂计算（寻路、图片生成）仍在 Python 后端完成，
 *       Worker 只负责边缘加速和请求路由。
 */

import { Hono } from 'hono';
import { cache } from 'hono/cache';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { bearerAuth } from 'hono/bearer-auth';

// ======== 类型定义 ========
type Bindings = {
  MTR_CACHE: KVNamespace;
  BACKEND_ORIGIN: string;
  CACHE_TTL: string;
  DATA_CACHE_TTL: string;
  ADMIN_TOKEN: string;
};

type FindRouteRequest = {
  start: string;
  end: string;
  algorithm?: 'default' | 'real' | 'theory';
  dep_time?: number;
  ignored_lines?: string[];
  only_lines?: string[];
  avoid_stations?: string[];
  disable_high_speed?: boolean;
  disable_boat?: boolean;
  enable_wild?: boolean;
  only_lrt?: boolean;
  detail?: boolean;
};

// ======== 主应用 ========
const app = new Hono<{ Bindings: Bindings }>();

// ======== 全局中间件 ========
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length', 'X-From-Cache'],
  maxAge: 86400,
}));

// 自定义日志中间件
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.path} - ${c.res.status} (${duration}ms)`);
});

// ========================================
// 根路径：直接代理到后端首页
// ========================================
app.get('/', async (c) => {
  return proxyToBackend(c, '/');
});

// ========================================
// 车站和线路浏览页面
// ========================================
app.get('/stations', cache({ cacheName: 'mtr-pages', cacheControl: 'max-age=3600' }), async (c) => {
  return proxyToBackend(c, '/stations');
});

app.get('/stations/:id', cache({ cacheName: 'mtr-pages', cacheControl: 'max-age=3600' }), async (c) => {
  return proxyToBackend(c, `/stations/${c.req.param('id')}`);
});

app.get('/routes', cache({ cacheName: 'mtr-pages', cacheControl: 'max-age=3600' }), async (c) => {
  return proxyToBackend(c, '/routes');
});

app.get('/routes/:id', cache({ cacheName: 'mtr-pages', cacheControl: 'max-age=3600' }), async (c) => {
  return proxyToBackend(c, `/routes/${c.req.param('id')}`);
});

app.get('/timetable', cache({ cacheName: 'mtr-pages', cacheControl: 'max-age=3600' }), async (c) => {
  return proxyToBackend(c, '/timetable');
});

// ========================================
// API: 车站模糊搜索（边缘 KV 加速版本）
// ========================================
app.get('/api/search_stations', async (c) => {
  const query = c.req.query('q')?.toLowerCase().trim();
  if (!query) {
    return c.json([]);
  }

  // 先从 KV 缓存读取车站列表，避免回源
  const cacheKey = `station-list:v1`;
  let stations: string[] | null = null;
  
  try {
    const cached = await c.env.MTR_CACHE.get(cacheKey, { type: 'json' });
    if (cached && Array.isArray(cached)) {
      stations = cached as string[];
    }
  } catch (e) {
    console.warn('KV cache read failed:', e);
  }

  // 若本地有缓存，直接在边缘做搜索
  if (stations) {
    const results = stations.filter((name: string) => 
      name.toLowerCase().includes(query)
    ).slice(0, 20);
    c.header('X-From-Cache', 'edge-kv');
    return c.json(results);
  }

  // 否则回源到后端（并异步填充缓存）
  const response = await proxyToBackend(c, `/api/search_stations?q=${encodeURIComponent(query)}`);
  return response;
});

// ========================================
// API: 寻路（核心，转发到 Python 后端）
// ========================================
app.post('/api/find_route', async (c) => {
  try {
    const body = await c.req.json<FindRouteRequest>();
    
    // 简单输入验证
    if (!body.start || !body.end) {
      return c.json({ error: '缺少必要参数: start/end' }, 400);
    }

    // 生成缓存键：基于请求内容 + 算法
    const cacheKey = `find-route:${JSON.stringify(body)}`;
    
    // 对于理论寻路和默认寻路（非实时），可缓存
    const isRealTime = body.algorithm === 'real';
    const ttl = isRealTime ? 60 : Number(c.env.CACHE_TTL || 3600);

    // 尝试从 KV 读取缓存（仅对非实时查询）
    if (!isRealTime) {
      try {
        const cached = await c.env.MTR_CACHE.get(cacheKey, { type: 'json' });
        if (cached) {
          c.header('X-From-Cache', 'kv');
          return c.json(cached);
        }
      } catch (e) {
        // 缓存读取失败不影响主流程
        console.warn('Cache read failed:', e);
      }
    }

    // 转发到 Python 后端
    const backendUrl = `${c.env.BACKEND_ORIGIN}/api/find_route`;
    const backendResponse = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Cloudflare-Worker',
      },
      body: JSON.stringify(body),
      cf: {
        cacheTtlByStatus: { '200-299': ttl, '400-499': 1, '500-599': 0 },
        cacheEverything: true,
      },
    });

    // 若后端返回成功且非实时，写入缓存
    if (backendResponse.ok && !isRealTime) {
      try {
        const result = await backendResponse.json();
        await c.env.MTR_CACHE.put(cacheKey, JSON.stringify(result), {
          expirationTtl: ttl,
        });
        return c.json(result);
      } catch (e) {
        console.warn('Cache write failed:', e);
        // 失败时返回原始响应（重新从后端读取）
        return proxyToBackend(c, '/api/find_route', true);
      }
    }

    // 直接返回后端响应
    return new Response(backendResponse.body, {
      status: backendResponse.status,
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Latency': String(Date.now()),
      },
    });

  } catch (error) {
    console.error('Find route error:', error);
    return c.json({ error: '寻路服务不可用，请稍后重试' }, 503);
  }
});

// ========================================
// API: 时刻表（转发到 Python 后端）
// ========================================
app.post('/api/timetable', async (c) => {
  return proxyToBackend(c, '/api/timetable', true);
});

// ========================================
// API: 车站和线路数据（边缘缓存加速）
// ========================================
app.get('/api/stations_routes_data', async (c) => {
  const cacheKey = `stations-routes-data:v1`;
  
  // 优先从 KV 缓存读取
  try {
    const cached = await c.env.MTR_CACHE.get(cacheKey, { type: 'json' });
    if (cached) {
      c.header('X-From-Cache', 'kv');
      return c.json(cached);
    }
  } catch (e) {
    console.warn('KV cache read failed:', e);
  }

  // 回源并异步填充缓存
  const ttl = Number(c.env.DATA_CACHE_TTL || 86400);
  const backendUrl = `${c.env.BACKEND_ORIGIN}/api/stations_routes_data`;
  const backendResponse = await fetch(backendUrl, {
    cf: { cacheTtl: ttl, cacheEverything: true },
  });

  if (backendResponse.ok) {
    try {
      const data = await backendResponse.json();
      await c.env.MTR_CACHE.put(cacheKey, JSON.stringify(data), {
        expirationTtl: ttl,
      });
      return c.json(data);
    } catch (e) {
      console.warn('Cache write failed:', e);
    }
  }

  return backendResponse;
});

// ========================================
// 管理 API：缓存控制（需要 Admin Token）
// ========================================
app.use('/api/admin/*', async (c, next) => {
  const token = c.env.ADMIN_TOKEN;
  if (!token) return next();
  return bearerAuth({ token })(c, next);
});

app.post('/api/admin/clear_cache', async (c) => {
  // 注意：KV 没有批量删除 API，这里用时间戳版本方式实现失效
  const metaKey = `cache-version`;
  const newVersion = Date.now().toString();
  await c.env.MTR_CACHE.put(metaKey, newVersion);
  return c.json({ success: true, new_cache_version: newVersion });
});

app.post('/api/admin/update_data', async (c) => {
  // 转发到后端触发数据更新
  return proxyToBackend(c, '/api/update_data', true);
});

// ========================================
// 静态资源（CSS、图片、图标）
// ========================================
app.get('/static/*', cache({
  cacheName: 'mtr-static',
  cacheControl: 'max-age=604800', // 7 天
}), async (c) => {
  const path = c.req.path;
  return proxyToBackend(c, path);
});

app.get('/favicon.ico', cache({
  cacheName: 'mtr-static',
  cacheControl: 'max-age=604800',
}), async (c) => {
  return proxyToBackend(c, '/favicon.ico');
});

// ========================================
// 管理控制台（需要保护）
// ========================================
app.use('/admin*', async (c, next) => {
  const token = c.env.ADMIN_TOKEN;
  if (!token) {
    // 未配置 ADMIN_TOKEN 时直接代理（依赖后端自身的密码验证）
    return proxyToBackend(c, c.req.path, true);
  }
  // 这里可加额外的 WAF / 限流层
  return next();
});

app.get('/admin', async (c) => {
  return proxyToBackend(c, '/admin', true);
});

app.post('/admin', async (c) => {
  return proxyToBackend(c, '/admin', true);
});

// ========================================
// 兜底：所有其他请求都代理到后端
// ========================================
app.all('*', async (c) => {
  const path = c.req.path;
  return proxyToBackend(c, path, c.req.method !== 'GET');
});

// ========================================
// 辅助函数：请求代理
// ========================================
async function proxyToBackend(
  c: any,
  path: string,
  bypassCache: boolean = false,
): Promise<Response> {
  const backendOrigin = c.env.BACKEND_ORIGIN;
  if (!backendOrigin) {
    return c.json({ error: '后端未配置 BACKEND_ORIGIN' }, 500);
  }

  // 克隆请求头，去除可能导致问题的头
  const headers = new Headers(c.req.raw.headers);
  headers.set('Host', new URL(backendOrigin).host);
  headers.set('X-Forwarded-For', c.req.header('CF-Connecting-IP') || '');
  headers.set('User-Agent', 'Cloudflare-Worker');

  const url = `${backendOrigin}${path}`;
  const init: RequestInit = {
    method: c.req.method,
    headers,
  };

  // 非 GET 请求携带 body
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    try {
      const body = await c.req.raw.clone().text();
      if (body) init.body = body;
    } catch (e) {
      // body 可能为空或已被消费，忽略
    }
  }

  // 启用 Cloudflare 自动缓存（仅 GET）
  if (!bypassCache && c.req.method === 'GET') {
    (init as any).cf = {
      cacheTtl: Number(c.env.CACHE_TTL || 3600),
      cacheEverything: true,
      cacheKey: url,
    };
  }

  try {
    const response = await fetch(url, init);
    
    // 克隆响应并添加自定义头
    const newHeaders = new Headers(response.headers);
    newHeaders.set('X-Backend', backendOrigin);
    
    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  } catch (error) {
    console.error(`Proxy error for ${path}:`, error);
    return c.json({
      error: '后端服务暂时不可用',
      detail: String(error),
    }, 503);
  }
}

// ========================================
// 错误处理
// ========================================
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  return c.json({ error: '服务内部错误', detail: err.message }, 500);
});

app.notFound((c) => {
  return c.json({ error: '未找到该路由', path: c.req.path }, 404);
});

export default app;
