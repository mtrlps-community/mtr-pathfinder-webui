# MTR Pathfinder - 部署方案总览

> 本项目提供 **3 种部署方案**，从最简单到最完整，可按需选择。

---

## ⭐ **推荐方案 A: PWA 纯前端（零服务器，零成本）**

**目录**：`deploy-pwa/` · **参考实现**：`YPetremann/MTR-Explorer`

### 架构

```
                     Cloudflare Pages (或任意静态托管)
                   ┌───────────────────────────────────────┐
                   │                                       │
                   │   index.html + CSS + JS 资源          │
                   │   public/data/stations_routes.json    │
                   │   (PWA Service Worker 预缓存)          │
                   │                                       │
                   └────────────┬──────────────────────────┘
                                │ HTTP
                                ▼
                        用户浏览器
                        ┌─────────────────────────────────────┐
                        │                                     │
                        │  React UI (主线程)                 │
                        │    ↑ Comlink RPC                   │
                        │    ↓                                │
                        │  Web Worker (后台线程)              │
                        │    · 数据加载与转换                │
                        │    · Segment 图构建                │
                        │    · Dijkstra 路径规划             │
                        │    · 车站搜索                      │
                        │                                     │
                        │  PWA: 离线可用，可安装到桌面        │
                        └─────────────────────────────────────┘
```

### 为什么推荐？

- **零运维**：没有任何服务器、数据库、Runtime 需维护
- **零成本**：Cloudflare Pages 免费额度足够（100GB 流量/月）
- **高性能**：路径计算在本地浏览器，不受 Cloudflare Workers 10ms CPU 限制
- **PWA 体验**：安装到桌面/主屏幕，离线可用
- **易扩展**：想加时刻表、实时寻路，只需改 Worker 代码和 JSON 数据

### 快速开始

```bash
cd deploy-pwa
npm install

# 1. 生成示例数据（或放入你自己的 MTR 数据）
npm run data:generate
# → public/data/stations_routes.json

# 2. 启动开发
npm run dev
# → http://localhost:5173

# 3. 构建并部署
npm run build
# 产物: dist/
# → 上传到 Cloudflare Pages / GitHub Pages / Vercel / Netlify
# 或: npx wrangler pages deploy dist
```

**部署到 Cloudflare Pages**：
- 在 Dashboard → Workers & Pages → Create → Pages → Connect Git
- 构建命令: `cd deploy-pwa && npm install && npm run build`
- 输出目录: `deploy-pwa/dist`

---

## 🔶 **方案 B: 混合架构（保留现有 Python 后端）**

**目录**：`deploy-hybrid/`

**适用场景**：已有 Flask/Python 后端，不想重写，只想加速。

```
                     Cloudflare Workers (代理 + 缓存)
                   ┌────────────────────────────────────────┐
                   │  1. 静态资源: CDN 边缘缓存              │
                   │  2. API 请求: 转发到后端（含边缘缓存）  │
                   │  3. 简单查询: 直接从 KV 响应            │
                   └────────────────┬───────────────────────┘
                                     │
                                     ▼
                            Cloudflare Tunnel
                              (无需公网 IP)
                                     │
                                     ▼
                            你的 Python 后端
                          (Docker / VPS / 本机)
```

### 快速开始

```bash
# 1. 启动 Python 后端（用项目自带的 Flask + Docker）
docker build -t mtr-pathfinder .
docker run -d -p 5000:5000 mtr-pathfinder

# 2. Cloudflare Tunnel 暴露到公网
cloudflared tunnel login
cloudflared tunnel create mtr-backend
cloudflared tunnel route dns mtr-backend mtr.your-domain.com
cloudflared tunnel run --url http://127.0.0.1:5000 mtr-backend &

# 3. 部署 Worker 边缘层
cd deploy-hybrid
npm install
# 编辑 wrangler.toml: BACKEND_ORIGIN = "https://mtr.your-domain.com"
npm run deploy
```

详细说明见 `deploy-hybrid/README.md`。

---

## 🔶 **方案 C: Cloudflare Workers TypeScript（小规模）**

**目录**：`deploy-pure-worker/`

**适用场景**：车站数 < 500，不想维护前端，直接 API 服务。

```
                Cloudflare Workers (TypeScript)
                   ┌───────────────────────────┐
                   │  KV: stations_routes data │
                   │                           │
                   │  Dijkstra / 搜索在 Worker │
                   │  内执行（注意 10ms 限制）  │
                   └────────────┬──────────────┘
                                │
                              JSON API
```

**限制**：免费套餐 Workers CPU 时间只有 10ms，付费套餐 50ms。大型 MTR 网络（> 1000 站）可能超时。

---

## 📊 方案对比总览

| 维度 | **方案 A: PWA** ⭐ | **方案 B: 混合** | **方案 C: 纯 Workers** |
|-----|-------------------|-----------------|------------------------|
| 零服务器 | ✅ 纯静态 | ❌ 需要 Python 后端 | ✅ |
| 零成本 | ✅ (免费额度) | ❌ (VPS/Docker) | ✅ |
| 功能完整度 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐（保留 Pillow 图片等） | ⭐⭐⭐ |
| 性能 | ⭐⭐⭐⭐⭐ (本地) | ⭐⭐⭐ (往返后端) | ⭐⭐ (受 CPU 限制) |
| 部署复杂度 | ⭐⭐⭐⭐⭐（git push 即完） | ⭐⭐（需运维） | ⭐⭐⭐ |
| 离线可用 | ✅ PWA | ❌ | ❌ |
| 推荐指数 | **⭐⭐⭐⭐⭐** | ⭐⭐⭐ | ⭐⭐ |

---

## 🔑 关键设计决策（参考 MTR-Explorer）

在研究 `YPetremann/MTR-Explorer`（一个 TypeScript 写的类似项目）后，我们采纳以下核心设计：

### 1. **Web Worker 计算**
路径规划是 CPU 密集型任务。放在主线程会导致 UI 卡顿；放在 Workers 受限于 10-50ms CPU。**放在用户浏览器的 Web Worker 中是最优解**。Comlink 让主线程调用 Worker 函数像普通 Promise 一样简单。

### 2. **Segment-Based 图模型**
不直接用 "车站 → 车站" 图，而是引入 "站台（Platform）" 和 "段（Segment）"：

```
Segment = 图的一条边
   · 乘车段: 站台 A1 → 站台 B1（同线路）
   · 步行段: 站台 → 所属车站（上下车）
   · 换乘段: 车站 A → 车站 B（出站步行换乘）
```

优势：**换乘成本天然精确**，不是人为加的常数。

### 3. **Dijkstra 的 3 种评分模式**
- **距离**（适合步行游戏）
- **时间**（最真实，需要时刻表或运行时间数据）
- **最少换乘**（对新玩家最友好，加权换乘成本）

### 4. **多语言名称支持**
`中環|Central|中環` 这样的格式，Worker 按语言优先级解析。

### 5. **PWA Service Worker 预缓存**
所有资源 + JSON 数据在首次访问后被缓存，离线可用。

详细技术分析见 `MTR_EXPLORER_ANALYSIS.md`。

---

## 📁 目录结构

```
/workspace
├── CLOUDFLARE_DEPLOYMENT.md  ← 本文件（总览）
├── MTR_EXPLORER_ANALYSIS.md  ← MTR-Explorer 源码分析 & 改进建议
│
├── deploy-pwa/                ← ⭐ 推荐：PWA 纯前端方案
│   ├── README.md              ← 详细部署指南
│   ├── vite.config.ts
│   │   ...
│   └── src/
│       ├── worker/data.worker.ts   ← 核心：数据加载 + 路径规划
│       │   ...
│       └── components/              ← React UI
│
├── deploy-hybrid/            ← 方案 B：Workers 边缘代理 + Python 后端
│   └── src/index.ts          ← Worker 反向代理代码
│
├── deploy-pure-worker/       ← 方案 C：纯 Cloudflare Workers（小规模）
│   └── src/
│       ├── worker/           ← Worker 算法代码
│       └── index.ts          ← API 入口
│
├── main.py                   ← 原 Python Flask 应用
└── Dockerfile                ← 原 Docker 配置
```

---

## 🔧 数据准备（所有方案通用）

无论选择哪个方案，你需要把 MTR 的数据导出为 JSON：

```json
[
  {
    "dim_id": "overworld",
    "stations": {
      "station_1": {
        "name": "中環|Central",
        "color": 14542202,
        "x": 50,
        "z": 50,
        "connections": ["station_2"]
      }
    },
    "routes": {
      "route_1": {
        "name": "港島線||Island Line",
        "color": 14542202,
        "type": "train_normal",
        "stations": ["station_1", "station_2"],
        "durations": [1800, ...]
      }
    },
    "positions": {}
  }
]
```

如果你已经有 Python 版本运行，可以用这段 Python 代码导出数据：

```python
import json

# 假设 pf 是你已初始化的 MTRPathfinder 对象
stations_out = {}
for sid, st in pf.stations.items():
    stations_out[sid] = {
        "name": st.name,
        "color": int(st.color_hex.replace('#', ''), 16),
        "x": getattr(st, 'x', 0),
        "z": getattr(st, 'z', 0),
        "connections": list(getattr(st, 'connections', set())),
    }

routes_out = {}
for i, (rid, rt) in enumerate(pf.routes.items()):
    routes_out[rid] = {
        "name": rt.name,
        "color": int(rt.color_hex.replace('#', ''), 16),
        "type": rt.transport_type,
        "stations": rt.stations,
        "durations": getattr(rt, 'durations', [20*30]*(len(rt.stations)-1)),
    }

data = [{
    "dim_id": "overworld",
    "stations": stations_out,
    "routes": routes_out,
    "positions": {},
}]

with open('deploy-pwa/public/data/stations_routes.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print("数据已导出")
```

---

## 🚀 快速决策：选哪个方案？

| 你想要什么 | 选哪个 |
|-----------|--------|
| 最快上线、零成本 | **方案 A (PWA)** |
| 不想放弃 Python 的 Pillow 图片生成 | **方案 B (混合)** |
| 只需要一个 JSON API 服务，站点数少 | **方案 C (纯 Workers)** |
| 需要 PWA 离线功能 | **方案 A (PWA)** |
| 需要保留管理后台/动态生成能力 | **方案 B (混合)** |

大多数场景下，**方案 A（deploy-pwa/）是最优解**。

---

## 📚 相关阅读

- `MTR_EXPLORER_ANALYSIS.md` — YPetremann/MTR-Explorer 源码分析（我们的设计灵感来源）
- `deploy-pwa/README.md` — 方案 A 详细部署步骤
- `deploy-hybrid/README.md` — 方案 B 详细部署步骤
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Comlink (GoogleChromeLabs)](https://github.com/GoogleChromeLabs/comlink)
- [Vite PWA 插件](https://vite-pwa-org.netlify.app/)
