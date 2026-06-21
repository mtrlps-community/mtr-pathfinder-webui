# MTR-Explorer 架构分析 & 部署方案改进

> 本报告分析 [YPetremann/MTR-Explorer](https://github.com/YPetremann/MTR-Explorer) 的核心架构，并给出**可直接应用到本项目**的改进建议。

## 一、MTR-Explorer 架构总览

### 技术栈

| 层级 | 技术 | 用途 |
|-----|------|------|
| 构建 | **Vite 5** | 极快的开发/构建体验 |
| UI | **React 18** + **React Router** | 单页应用 + 路由 |
| 样式 | **Tailwind CSS** | 原子化 CSS |
| 可视化 | **Konva** + **React-Konva** | Canvas 渲染交互式线路图 |
| 异步计算 | **Web Worker** + **Comlink** | 后台线程加载数据 + 路径规划 |
| 部署 | **GitHub Pages** + **PWA** | 纯静态托管，支持离线使用 |
| 语言 | **TypeScript 5.5** | 类型安全 |

### 目录结构（核心部分）

```
MTR-Explorer/
├── definitions/              ← 数据类型定义（与 Worker 共享）
│   ├── data.ts              ← 原始 MTR 数据格式
│   └── worker.ts            ← Worker 使用的数据结构
├── src/
│   ├── index.tsx            ← 主入口（React 挂载点）
│   ├── Router.tsx           ← 路由（Travel / Routes / Stations）
│   ├── components/          ← UI 组件
│   ├── contexts/            ← React Context（状态管理）
│   │   ├── data.ctx.tsx    ← MTR 数据上下文
│   │   ├── config.ctx.tsx  ← 配置上下文
│   │   └── profile.ctx.tsx ← 数据源选择（地图URL）
│   ├── solutions/
│   │   └── mixedContent.ts ← CORS 代理（解决跨域问题）
│   └── worker/              ← ✨ 核心：Web Worker（不阻塞主线程）
│       ├── data.ts          ← Worker 的 Comlink 实例
│       └── data.worker.ts   ← 实际逻辑：数据加载 + 路径规划算法
└── vite.config.ts           ← Vite 配置（PWA, Comlink 插件）
```

---

## 二、关键创新点：**Web Worker + Comlink 模式**

### 2.1 为什么用 Web Worker?

MTR 数据处理和路径规划是**计算密集型任务**：
- 可能有 1,000+ 个车站
- 数百条线路
- 数十万个 "segments"（图的边）

如果在主线程执行，会导致 UI 卡顿。MTR-Explorer 的解决方案：**把所有计算放到 Web Worker 中**。

### 2.2 Comlink 简化 Worker 通信

Comlink 是 Google 出品的 RPC 库，它让你**像调用普通函数一样调用 Worker**：

```typescript
// ====== Worker 端 (src/worker/data.worker.ts) ======
// 普通的函数，只是运行在另一个线程中
export async function load(source, progressCb) { /* 加载数据 */ }
export function getData() { return workerData; }
export function calcPath(nodes: string[], mode: Mode) { /* 计算路径 */ }

// ====== 主线程端 (src/worker/data.ts) ======
// 一行代码，把 Worker 暴露的函数变成可调用的 Promise
export const dataWorker = new ComlinkWorker<typeof import("./data.worker")>(
  new URL("./data.worker", import.meta.url)
);

// 在 React 组件中使用，和调用普通 API 一样：
dataWorker.load(source, proxy(setLoading));  // 加载数据
dataWorker.calcPath([fromId, toId], "distance");  // 计算路径
```

**关键配置** (`vite.config.ts`)：
```typescript
plugins: [
  react(),
  comlink(),           // Comlink 插件
  VitePWA({...}),      // PWA 插件
],
worker: { plugins: () => [comlink()] },  // Worker 也需要 Comlink
```

---

## 三、图模型对比：**Segment-Based vs Station-Based**

### 3.1 我们项目的简化模型（Station-Based）

```
车站 A ──[线路X]── 车站 B ──[线路X]── 车站 C
```

优点：简单，图小
缺点：
- 换乘时间不准确（同一站换乘 vs 步行100m换乘相同）
- 站台差异被忽略（大车站可能有 10+ 个不同站台）
- 不支持精确的等待时间计算

### 3.2 MTR-Explorer 的精确模型（Segment-Based）

```
车站 A
  ├── 平台 A1 ──[线路X, segment 1]── 平台 B1 ──[线路X, segment 2]── 平台 C1
  ├── 平台 A2 ──[线路Y, segment 3]── ...
  └── 步行段（站内换乘）
       ├── 平台 A1 ←→ 平台 A2（步行连接）
       └── 连接其他车站（出站换乘，如 "cross-station connection"）

车站 B
  ├── 平台 B1 (线路X)
  ├── 平台 B2 (线路Z)
  └── 步行段：B1 ←→ B2（换乘时间）
```

**数据结构层级**：

```typescript
// definitions/worker.ts
interface Station {
  index: number;       // 数组索引（快速访问）
  id: string;          // MTR 内部 ID
  name: string[];      // 多语言名称 ["中環", "Central", ...]
  dim: string;         // 维度（overworld/nether/end）
  pos: { x, z };       // 游戏内坐标
  color: string;       // 颜色
  connections: number[];  // 连接的其他车站索引（跨站换乘）
  platforms: number[];    // 本站台索引
  routes: number[];       // 经过的线路索引
  next: number[];         // 出站 segments
  prev: number[];         // 入站 segments
}

interface Platform {
  index: number;
  id: string;
  station: number;      // 所属车站索引
  routes: number[];     // 经过的线路
  pos: { x, z };
  next: number[];       // 从此平台出发的 segments
  prev: number[];       // 到此平台的 segments
}

interface Route {
  index: number;
  id: string;
  name: string[];       // ["港岛线", "Island Line", ...]
  number: string[];     // 线路编号
  color: string;        // 颜色
  type: string;         // 交通工具类型（train/boat/cable_car/airplane）
  circular: boolean;    // 是否环线
  stations: number[];   // 车站索引序列
  platforms: number[];  // 站台索引序列
  durations: number[];  // 站间运行时间（ticks）
  densities: number[];  // 密度信息
}

interface Segment {      // ✨ 图的边：连接两个 "节点"
  index: number;
  route: { type, index };       // 线路信息（walk 类型为步行）
  from: { type: 'platform' | 'station', index };
  to: { type: 'platform' | 'station', index };
  distance: number;
  duration: number;             // 运行时间
  wait?: number;                // 等待时间
  prev: number[];               // 前驱 segments
  next: number[];               // 后续 segments
}
```

### 3.3 三种 Segment 类型的创建

```typescript
// 类型 1: 线路段 (route) —— 连接两个相邻站台
// 例：线路X的 站台A1 → 站台B1
{ route: { type: "train", index: 42 }, from: platformA1, to: platformB1, ... }

// 类型 2: 平台段 (walk) —— 连接站台与所属车站
// 例：站台A1 → 车站A（下车），车站A → 站台A1（上车）
{ route: { type: "walk", index: -1 }, from: platformA1, to: stationA, ... }
{ route: { type: "walk", index: -1 }, from: stationA, to: platformA1, wait: WAIT_DELAY }

// 类型 3: 车站间步行段 (walk) —— 连接跨站换乘（connections）
// 例：车站A → 车站C（通过出站换乘）
{ route: { type: "walk", index: -1 }, from: stationA, to: stationC, ... }
```

这种精细的建模意味着：
- **换乘成本精确**：步行距离 → 时间（`WALK_SPEED = 4.137 / 20` bloc/tick）
- **站台有等待成本**：`WAIT_DELAY = 20 * 90`（相当于约 60 秒）
- **可以追踪具体的站台编号**（MTR 游戏中不同站台有不同班次）

---

## 四、路径规划算法详解

### 4.1 算法：**BFS + 动态评分（Dijkstra 的变体）**

```typescript
// src/worker/data.worker.ts
function calcPath(nodes: string[], mode: Mode) {
  // 1. 解析：nodes 是一个车站 ID 序列，如 [stationA, stationB, stationC]
  //    我们要算 A→B，然后 B→C，组合起来
  const stationIds = nodes.map(id => stations.findIndex(st => st.id === id));
  const parts = stationIds.slice(1).map((t, i) => [stationIds[i], t]);
  //    parts = [[A,B], [B,C]]

  // 2. 选择评分函数
  const scoring = Scoring[mode]; // mode: "routes" | "distance" | "duration"

  // 3. 分段计算
  const list = parts.map(([from, to]) => calcPathGen(from, to, scoring));

  // 4. 美化并返回
  return beautifyPath(list);
}

function calcPathGen(from: number, to: number, scoring: ScoringFn) {
  // a) 重置：为每个 segment 初始化评分
  resetCalcScore();

  // b) 起点标记：从起点车站的所有出站 segments 开始
  const segments = new Set(stations[from].next);
  for (const seg_id of segments) {
    calcs[seg_id].prev = -1;           // -1 表示起点
    calcs[seg_id].prev_score = 0;
  }

  // c) 主循环：BFS 方式扫描所有可达 segments
  //    注意：这是一个"边优先"的遍历，而不是"点优先"
  //    每个 segment 就是一个"边"，但我们把它当成"节点"来处理
  //    这样可以天然追踪：乘坐哪条线路、从哪个站台出发
  for (const seg_id of segments) {
    const segment = workerData.segments[seg_id];
    const calc = calcs[seg_id];

    // 计算通过这个 segment 后的累积评分
    calc.next_score = scoring(calc, segment);

    // 扫描后续 segments，更新它们的评分
    for (const next_id of segment.next) {
      const calc_next = calcs[next_id];
      // Dijkstra 核心：如果通过当前路径到达 next 更优，则更新
      if (calc_next.prev_score > calc.next_score) {
        calc_next.prev_score = calc.next_score;
        calc_next.prev = seg_id;
        segments.add(next_id);  // 加入待处理集合
      }
    }
    segments.delete(seg_id);  // 处理完毕，移除以防重复
  }

  // d) 回溯：从终点反向找到起点
  let prev = stations[to].prev
    .toSorted((a, b) => calcs[a].next_score - calcs[b].next_score)
    .at(0);  // 选择到达终点成本最低的 segment

  const chain: number[] = [];
  while (prev !== -1 && prev !== undefined) {
    chain.push(prev);
    prev = calcs[prev].prev;
  }
  chain.reverse();
  return chain;
}
```

### 4.2 三种评分模式（Scoring）

```typescript
const Scoring = {
  // 1. 最小化 **持续时间**（最真实的路径规划）
  duration: (calc, segment) => calc.prev_score + segment.duration + calc.wait,

  // 2. 最小化 **距离**（最快，但可能绕远路）
  distance: (calc, segment) => calc.prev_score + segment.distance,

  // 3. 最小化 **换乘次数**（最少线路数，推荐给新玩家）
  routes: (calc, segment) => {
    const prevSegment = workerData.segments[calc.prev];
    const routeCur = segment.route.index;
    const routePrev = prevSegment?.route?.index ?? -1;
    const transfer = routeCur < 0 || routeCur !== routePrev ? 1 : 0;
    return calc.prev_score + transfer;
  },
};
```

### 4.3 为什么用 Segment 而不是 Station 作为图节点？

**我们之前的简化版本**：
```
车站A → 车站B → 车站C  （每对相邻站之间有边，权重是距离/时间）
```
问题：无法区分「乘坐的是哪条线路？」，所以计算换乘很麻烦

**MTR-Explorer 的版本**：
```
Segment_1 (线路X, 站台A1 → 站台B1)
  → 连接站台B1的出站段
    → Segment_2 (线路X, 站台B1 → 站台C1)
    或 → Segment_walk (站台B1 → 车站B → 站台B2)
        → Segment_3 (线路Y, 站台B2 → 站台D1)
```

优势：**换乘成本变成天然的"步行 segment"**，算法自动处理无需额外逻辑！

---

## 五、数据加载和处理流程

```
用户选择 MTR 服务器（URL）
  ↓
React DataProvider 触发 useEffect
  ↓
dataWorker.load(source, progressCb)  ← Web Worker 中执行
  ↓
mixedContent.fetchJson(url)          ← CORS 代理解决跨域
  ↓
原始 MTR JSON 数据（stations + routes + positions）
  ↓
transformStations / transformRoutes / transformPlatforms
  ↓
populateWorkerData → 创建统一的 data 对象
  ↓
createRouteSegments + createPlatformSegments + createStationSegments
  ↓ 构建完整的 segment 图（边）
linkSegmentToThings / linkSegmentsTogether
  ↓
deepFreeze（冻结所有数据，防止意外修改）
  ↓
dataWorker.getData() → 返回给主线程
  ↓
React 组件使用（搜索、路径规划、可视化）
```

---

## 六、对我们项目的改进建议

### 改进 1：**Web Worker 模式（强烈推荐）**

**为什么重要**：
- Cloudflare Workers 的 CPU 时间限制严格（免费版 10ms）
- 如果我们的路径规划计算超过 10ms，请求会被强制终止
- 把繁重计算**离线化**到用户浏览器的 Web Worker 中，Edge 只负责**数据分发**

**应用方案**：

```
                    ┌────────────────────────────┐
用户浏览器          │ Cloudflare Edge (KV/CDN)   │
┌──────────────┐    │                            │
│ React UI     │    │  只存 JSON 数据 + 静态资源  │
│ (主线程)     │◀───┼─── GET /data.json          │
└──────┬───────┘    │                            │
       │            │  ✨ 没有任何服务端计算     │
       ▼            │                            │
┌──────────────┐    └────────────────────────────┘
│ Web Worker   │
│ (后台线程)   │ ◄────── 在此处执行路径规划
│  - 加载数据  │
│  - 建图      │
│  - Dijkstra  │
└──────────────┘
```

**好处**：
- ✅ Cloudflare Worker **零计算**，只做 CDN
- ✅ 没有 CPU 超时限制（浏览器有充足的算力）
- ✅ 支持 PWA 离线使用（MTR-Explorer 的做法）
- ✅ 成本极低：只有 KV 存储和带宽费用
- ✅ 部署简单：纯静态文件 + Cloudflare Pages

### 改进 2：**Segment-Based 图模型**

将我们的图从「车站-车站」升级到「站台-站台」级别，提高路径规划的准确性：

```typescript
// 之前：简单的 station 图
stations: Map<stationId, { name, pos, connections, routes }>
graph: Map<stationId, [{ to: stationId, weight, routeId }]>

// 之后：segment 为中心的精确图（参考 MTR-Explorer）
stations: Station[]         // 索引数组
platforms: Platform[]       // 索引数组
routes: Route[]             // 索引数组
segments: Segment[]         // 索引数组 ✨ 这是图的"边"
// 索引 ID 映射：id → 数组索引（O(1) 查找）
stationIndex: Map<string, number>
```

这种"数组索引"模式比 Map 更高效：
- `stations[42]` 比 `stations.get("station_42")` 快 5-10x
- 内存占用更小（连续数组 vs 哈希表）
- 天然支持 `next` / `prev` 引用（用 number 索引代替对象引用）

### 改进 3：**多评分模式**

提供 3 种路径规划模式，用户可选择：

```
1. 最少换乘次数 (routes)    → 适合新手 / 复杂网络
2. 最短距离 (distance)       → 最快但可能绕路
3. 最短时间 (duration)       → 最精确但需要时刻表数据
```

### 改进 4：**PWA + GitHub Pages / Cloudflare Pages 部署**

MTR-Explorer 就是纯静态部署的！我们也可以：

```bash
# 构建
npm run build  # 生成 dist/ (纯静态)

# 部署到 Cloudflare Pages
# 1. GitHub Actions 自动部署
# 2. 或使用 wrangler pages deploy dist/

# 支持 PWA 离线使用
#  - 第一次访问后缓存所有资源
#  - 无网络连接也能使用
```

---

## 七、推荐的最终部署架构（融合两边精华）

### 方案 A+：**Cloudflare Pages 纯静态 + Web Worker 计算**（推荐 ⭐⭐⭐⭐⭐）

```
┌─────────────────────────────────────────────────────────────────────┐
│                            用户浏览器                                │
│                                                                    │
│   ┌──────────────────┐        ┌───────────────────────────┐        │
│   │   React 前端     │◀───────│   Web Worker (计算线程)    │        │
│   │  (页面/交互)     │ Comlink│  - 从 KV 加载线路数据      │        │
│   └─────────┬────────┘        │  - 建 segment 图            │        │
│             │                 │  - calcPath() 路径规划      │        │
│             │                 │  - 车站/线路搜索            │        │
│             │                 └──────────────┬────────────┘        │
│             │  静态资源                       │                       │
│             │  (HTML/CSS/JS)                 │ fetch JSON           │
│             │                                 ▼                      │
└────────────┬────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Edge                              │
│                                                                    │
│   ┌─────────────┐  ┌───────────────┐  ┌───────────────┐             │
│   │ Pages (CDN) │  │ KV 数据存储    │  │ R2 对象存储   │             │
│   │ - index.html│  │ stations.json │  │ (可选图片)    │             │
│   │ - *.js     │  │ routes.json    │  │               │             │
│   │ - *.css    │  │ timetable.json │  │               │             │
│   └─────────────┘  └───────────────┘  └───────────────┘             │
│                                                                    │
│   ✨ NO SERVER CODE!  ✨ 纯静态托管，零计算                          │
└─────────────────────────────────────────────────────────────────────┘
```

**优点**：
- ✅ **零运维成本**：Cloudflare 免费额度完全够用
- ✅ **全球低延迟**：数据在边缘节点
- ✅ **可离线使用**：PWA 支持
- ✅ **无限 CPU 时间**：计算在用户浏览器，不受 Edge 限制
- ✅ **安全**：没有服务端逻辑，没有攻击面

**缺点**：
- ❌ 首次加载可能较慢（取决于网络）
- ❌ 实时时刻表需要定时更新数据

---

## 八、与原有方案对比

| 维度 | 原 Flask 方案 | 之前的 Cloudflare Workers 方案 | MTR-Explorer 启发的新方案 |
|-----|------------|------------------------------|---------------------------|
| 后端语言 | Python | TypeScript | 无后端 |
| 后端服务器 | Docker / VPS | Cloudflare Workers | **纯静态 + Web Worker** |
| 路径计算 | Flask 服务器 | Cloudflare Workers | **用户浏览器** |
| 图片生成 | Pillow | 需改写/移除 | **Konva Canvas (前端渲染)** |
| CPU 限制 | 服务器内存 | 10-50ms | **浏览器内存/CPU** |
| 冷启动 | 几秒 (Docker) | 50-200ms | **0ms (本地计算)** |
| 部署复杂度 | 中 | 低 | **极低** |
| 月成本 | $5-20 | ~$0 | **$0 (免费额度)** |
| PWA 支持 | 需手动加 | 需手动加 | **原生支持** |
| 离线使用 | ❌ | ❌ | **✅** |
| 实时寻路 | ✅ | ⚠️ 受限 | **✅ 浏览器计算** |

---

## 九、实现路线图

### Phase 1：数据层（1-2 天）
1. [ ] 定义 `Segment` 数据结构（参考 MTR-Explorer）
2. [ ] 编写数据转换脚本：MTR JSON → 我们的格式
3. [ ] 测试加载和索引构建

### Phase 2：Worker 层（2-3 天）
1. [ ] 设置 Vite + Comlink
2. [ ] 在 Web Worker 中实现 `load()` 和 `calcPath()`
3. [ ] 实现 Dijkstra 算法的 Segment 版本
4. [ ] 三种评分模式（routes/distance/duration）

### Phase 3：UI 层（2-3 天）
1. [ ] React + Tailwind（或沿用现有模板）
2. [ ] 车站选择界面
3. [ ] 路径结果展示（站点列表、换乘信息、颜色高亮）
4. [ ] **Konva 线路图可视化**（参考 MTR-Explorer）

### Phase 4：部署和优化（1 天）
1. [ ] 设置 PWA（`vite-plugin-pwa`）
2. [ ] 部署到 Cloudflare Pages / GitHub Pages
3. [ ] 配置缓存策略（`Cache-Control` headers）

### Phase 5：可选高级功能
1. [ ] 时刻表查询（导入 MTR `DynamicSchedule` 数据）
2. [ ] 实时寻路（考虑到站时间）
3. [ ] 自定义地图（不同 MTR 服务器支持）
4. [ ] 收藏功能（PWA IndexedDB 存储）

---

## 十、核心代码片段模板（可直接复制）

### 10.1 Vite + Comlink 配置
```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { comlink } from "vite-plugin-comlink";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    comlink(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["**/*.json", "**/*.png", "**/*.svg"],
      manifest: {
        name: "MTR Pathfinder",
        short_name: "MTR",
        description: "MTR 线路路径规划",
        theme_color: "#b42249",
      },
    }),
  ],
  worker: { plugins: () => [comlink()] },
});
```

### 10.2 Web Worker 入口
```typescript
// src/worker/data.worker.ts
// 数据和路径规划都在这里执行（不阻塞主线程）
import type { Station, Route, Segment, Platform } from "../../definitions/worker";

const data = {
  stations: [] as Station[],
  routes: [] as Route[],
  platforms: [] as Platform[],
  segments: [] as Segment[],
};

// 索引（O(1) 查找）
const indexes = {
  stations: new Map<string, number>(),
  routes: new Map<string, number>(),
};

// 计算结果缓存
const calcs: Array<{ wait: number; prev: number; prev_score: number }> = [];

/**
 * 加载数据：从 URL 或直接传入
 */
export async function load(source: string | object) {
  let rawData: object;
  if (typeof source === "string") {
    const res = await fetch(source);
    rawData = await res.json();
  } else {
    rawData = source;
  }
  // 解析 stations, routes, platforms...
  // 构建 segments 图...
  // (详细实现参考 MTR-Explorer 的 transformXxx 函数)
}

/**
 * 路径规划：返回 segment 索引链
 */
export function calcPath(stationIds: string[], mode: "routes" | "distance" | "duration") {
  // 使用 Dijkstra 变体（见上文算法详解）
  // 返回美化后的路径结果
}

export function getData() { return data; }
```

### 10.3 主线程中使用 Worker
```typescript
// src/worker/data.ts
export const dataWorker = new ComlinkWorker<
  typeof import("./data.worker")
>(new URL("./data.worker", import.meta.url));

// 在 React 组件中：
import { dataWorker } from "../worker/data";

// 加载数据
await dataWorker.load("/data/stations_routes.json");

// 路径规划
const path = await dataWorker.calcPath([fromStationId, toStationId], "distance");
```

### 10.4 React Context 数据提供者
```typescript
// src/contexts/data.ctx.tsx
import { proxy } from "comlink";
import React from "react";
import { dataWorker } from "../worker/data";

const DataContext = React.createContext<{ data: any }>({ data: null });

export function DataProvider({ children }) {
  const [data, setData] = React.useState(null);

  React.useEffect(() => {
    // 加载数据（带进度回调）
    dataWorker
      .load("/data/stations_routes.json", proxy(([pct, msg]) => {
        console.log(msg, `${Math.round(pct * 100)}%`);
      }))
      .then(() => dataWorker.getData())
      .then(d => setData(d));
  }, []);

  return (
    <DataContext.Provider value={{ data }}>
      {children}
    </DataContext.Provider>
  );
}
```

---

## 十一、结论

MTR-Explorer 给我们最有价值的经验是：

1. **Web Worker 是关键**：把计算从服务器移到浏览器，既省成本又打破限制
2. **Segment-Based 图模型**：比单纯的 station-station 图更精确，换乘逻辑天然处理
3. **Comlink 让 Worker 开发体验**和普通函数一样好
4. **纯静态部署**（Cloudflare Pages / GitHub Pages）：免费、简单、快速
5. **PWA**：支持离线使用，用户体验更好

我们现在的 `deploy-pure-worker` 方案过于保守（仍在 Edge 做计算），建议**升级为「Cloudflare Pages 纯静态 + Web Worker 计算」**模式。

这实际上是 MTR 路径规划应用的**最佳架构**，因为：
- 用户数量不大（几百到几千 DAU）→ 不需要服务器端扩展
- 计算可并行（每个用户有自己的浏览器）→ 比服务器更高效
- 数据是公开的（MTR 地图）→ 不需要隐私保护
- PWA 体验对游戏玩家很友好（离线查线路！）

**建议下一步**：按照「实现路线图」Phase 1-2 实现 Worker 层，然后决定是否替换当前 Flask 实现或保留混合架构。
