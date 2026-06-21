# 🚇 MTR Pathfinder - PWA 版（推荐部署方案）

> 纯前端 · 无需服务器 · 后台计算 · 可离线使用

## ✨ 核心特性

| 特性 | 说明 |
|-----|------|
| **⚡ 纯前端** | 只有 HTML/JS/CSS，零服务端代码 |
| **🧠 Web Worker** | 路径计算在后台线程，不阻塞 UI |
| **📱 PWA** | 安装到桌面/主屏幕，离线可用 |
| **🔍 模糊搜索** | 中文/英文/拼音模糊匹配 |
| **🎯 3 种规划模式** | 最短距离 / 最短时间 / 最少换乘 |
| **🧩 Segment-Based 图** | 精细建模，换乘成本准确 |
| **🔒 零依赖** | 不需要任何后端服务 |

---

## 🆚 三种部署方案对比

本项目提供 **3 种部署方案**，可按需选择：

| 方案 | 目录 | 后端 | 路径计算 | 适用场景 |
|-----|------|-----|---------|---------|
| **⭐ 方案 A: PWA（本目录）** | `deploy-pwa/` | 无 | 浏览器 Web Worker | **推荐**，大多数情况 |
| **方案 B: Worker 边缘代理** | `deploy-hybrid/` | Flask (Docker) | Cloudflare Worker 代理到后端 | 已有 Python 后端 |
| **方案 C: 纯 Workers** | `deploy-pure-worker/` | Cloudflare Workers | Workers Runtime | 小规模快速部署 |

### 方案 A（本方案）优势

```
┌──────────────────────────────────────────────────────┐
│  用户浏览器                                           │
│                                                        │
│  ┌──────────┐           ┌────────────────────────┐   │
│  │ React UI │ ◀─────── │  Web Worker            │   │
│  │          │   Comlink │   - 加载数据           │   │
│  │ (主线程) │           │   - 构建 Segment 图    │   │
│  │          │           │   - Dijkstra 路径规划  │   │
│  └────┬─────┘           │   - 车站搜索           │   │
│       │                 └────────────────────────┘   │
│       │ 静态资源（HTML/CSS/JSON）                      │
│       ▼                                                │
│  Cloudflare Pages / GitHub Pages / 任意静态托管        │
└──────────────────────────────────────────────────────┘
```

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd deploy-pwa
npm install
```

### 2. 生成示例数据

```bash
npm run data:generate
# ✅ 已生成示例数据: public/data/stations_routes.json
#    66 个车站, 10 条线路, 80+ 站台
```

（首次开发前必须运行一次，否则首页会报加载错误）

### 3. 启动开发服务器

```bash
npm run dev
# → http://localhost:5173
```

### 4. 构建生产版本

```bash
npm run build
# 产物在 dist/ 目录
```

### 5. 部署到 Cloudflare Pages

```bash
# 方式一：自动部署（推荐）
# 在 Cloudflare Pages Dashboard 连接 GitHub 仓库
# 构建命令: cd deploy-pwa && npm install && npm run build
# 输出目录: deploy-pwa/dist

# 方式二：手动上传
npm run build
npx wrangler pages deploy dist
```

同样适用于:
- **GitHub Pages** (`npm run build` 后推送到 `gh-pages` 分支)
- **Vercel / Netlify** (Zero-config)
- **任何静态文件服务器** (Nginx, S3 + CloudFront, 等)

---

## 📁 项目结构

```
deploy-pwa/
├── index.html              # 入口 HTML
├── package.json            # 依赖和脚本
├── vite.config.ts          # Vite + PWA + Comlink 配置
├── tailwind.config.js      # Tailwind CSS
├── postcss.config.js       # PostCSS
├── tsconfig.json           # TypeScript 配置
├── definitions/
│   └── worker.ts           # 数据类型定义（主线程和 Worker 共享）
├── scripts/
│   └── generate-sample-data.mts  # 示例 MTR 数据生成器
├── public/
│   └── data/
│       └── stations_routes.json  # ← 你的真实数据放这里
└── src/
    ├── index.tsx           # React 入口
    ├── styles.css          # 全局样式 (Tailwind)
    ├── worker/
    │   ├── data.ts         # Comlink 代理导出 (主线程用)
    │   └── data.worker.ts  # ✨ Worker 主逻辑：数据加载 + 路径规划
    ├── contexts/
    │   └── DataContext.tsx # React 状态管理
    └── components/
        ├── App.tsx         # 主应用
        ├── StationSearch.tsx     # 车站搜索（带模糊补全）
        ├── PathResultCard.tsx    # 路径结果时间轴
        ├── RoutesList.tsx        # 线路列表
        ├── StationsList.tsx      # 车站列表
        └── LoadingScreen.tsx     # 加载屏幕
```

---

## 📊 数据格式

Worker 期望的数据格式与 MTR 模组导出的数据一致：

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
        "stations": ["station_1", "station_2", "..."],
        "durations": [1800, 1800, ...]
      }
    },
    "positions": {
      "station_1_0": { "x": 50, "y": 52 }
    }
  }
]
```

| 字段 | 含义 |
|-----|------|
| `dim_id` | 维度：`overworld` / `nether` / `end` |
| `stations[id]` | 车站表（id → 车站对象） |
| `stations[id].name` | 多语言名称，用 `|` 分隔 |
| `stations[id].color` | 十进制 RGB 颜色值 |
| `stations[id].x / z` | Minecraft 世界坐标 |
| `stations[id].connections` | 可步行换乘的车站 id 列表 |
| `routes[id].stations` | 此线路经过的车站 id 序列 |
| `routes[id].durations` | 每段站间运行时间（ticks） |
| `positions[platform_id]` | 站台坐标（可选） |

### 从现有 Python 后端导入

如果你已经有 Flask 版本在跑，可以从它导出数据：

```python
# 在你的 Python 后端：
import json
from mtr_pathfinder_lib import MTRPathfinder

# 加载你的数据
pf = MTRPathfinder()  # 你的实际初始化

# 导出为标准格式
data = {
    "dim_id": "overworld",
    "stations": {
        sid: {
            "name": st.name,
            "color": int(st.color_hex.replace('#', ''), 16),
            "x": st.x,
            "z": st.z,
            "connections": list(st.connections),
        }
        for sid, st in pf.stations.items()
    },
    "routes": {
        f"route_{i}": {
            "name": rt.name,
            "color": int(rt.color_hex.replace('#', ''), 16),
            "type": rt.transport_type,
            "stations": rt.stations,
            "durations": rt.durations,
        }
        for i, rt in enumerate(pf.routes.values())
    },
    "positions": {},
}

with open('deploy-pwa/public/data/stations_routes.json', 'w', encoding='utf-8') as f:
    json.dump([data], f, ensure_ascii=False, indent=2)
```

然后部署时，这个 JSON 文件会被预缓存到 PWA。

---

## 🧠 路径规划算法

### Segment-Based 图模型

与简化的「车站-车站」图不同，我们把 **站台（Platform）** 作为一等公民：

```
车站 A
  ├── 站台 A1 ────[线路X]────▶ 站台 B1 ────[线路X]────▶ 站台 C1
  │     (步行段)                 (乘车段)
  └── 站台 A2 ────[线路Y]────▶ ...

步行段 (platform → station) 是连接站台和站厅的边
换乘段 (station → station) 是跨站步行连接
```

这意味着：
- **换乘成本真实**：不是人为加上的常量，而是基于距离计算
- **站台区分**：同一线路不同方向不共享
- **等待时间**：可以加入发车等待

### Dijkstra 算法

```
输入: 起点 station S, 终点 station T
输出: S → T 的最优路径

1. 把 S 的所有出站 segment 加入待处理队列
2. 对于每个 segment：
   a. 计算"到达此 segment 终点"的成本
   b. 扫描此 segment 的后续 segment
   c. 如果"经此 segment 到达后续节点"更优，更新并加入队列
3. 从 T 反向回溯，重建路径
```

### 评分函数（3 种模式）

| 模式 | 每条 segment 的权重 |
|-----|-------------------|
| 最短距离 | `segment.distance` |
| 最短时间 | `segment.duration + wait_time` |
| 最少换乘 | 同线路 = 1，换乘 = 100 |

---

## 🏗️ 开发指南

### 添加新功能

```bash
# 调试：打开浏览器开发者工具
# - Console: 查看 Worker 输出和错误
# - Application → Service Workers: 管理 PWA 缓存
# - Performance: 分析路径规划耗时（目标 < 200ms）
```

### Worker 调试技巧

1. **在 `data.worker.ts` 中加 `console.log()`**：Worker 的 console 会显示在 Chrome DevTools 的 "Console" 面板（注意筛选 "workers"）
2. **查看 Worker 源文件**：DevTools → Sources → Page → (no domain) → comlink:data.worker.ts
3. **性能分析**：Performance 面板录制后，查看 "WebWorker" 线程的执行情况

### 替换为真实 MTR 数据

1. 使用 MTR 模组的系统地图数据导出功能（或脚本爬取）
2. 保存为 `public/data/stations_routes.json`，格式如上
3. `npm run dev` 即可看到真实线路

---

## 🔧 生产部署清单

- [x] 数据文件 `public/data/stations_routes.json` 已准备
- [x] `npm run build` 测试无错误
- [x] PWA 图标（可选：替换 `public/icon-192.png` 和 `icon-512.png`）
- [x] 检查离线模式（断网后刷新仍可使用）
- [ ] 配置自定义域名（可选）
- [ ] 配置 Cloudflare Pages / GitHub Pages 自动部署

---

## 📦 部署到 Cloudflare Pages

### 方案 1：Dashboard 操作（最简单）

1. 把整个项目推送到 GitHub
2. 登录 Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
3. 选择你的仓库
4. **构建配置**：
   - Framework preset: `Vite`
   - Build command: `cd deploy-pwa && npm install && npm run build`
   - Build output directory: `/deploy-pwa/dist`
5. 点击 Save and Deploy
6. 几分钟后，你会得到一个 `xxx.pages.dev` 域名
7. (可选) 添加自定义域名

### 方案 2：Wrangler CLI

```bash
cd deploy-pwa
npm install
npm run build

# 首次部署（需要登录）
npx wrangler pages deploy dist

# 部署成功后会输出:
# ✨ Successfully published your script to
# https://your-project.pages.dev
```

---

## 📈 性能优化建议

1. **大型网络（> 500 站）**
   - 在 Worker 中使用优先队列（二叉堆）替代简单 Set
   - 在数据预处理阶段预计算 station_id → index 的 Map
2. **搜索加速**
   - 构建倒排索引：token → stations
   - 用 Map 缓存搜索结果
3. **首次加载**
   - 把 JSON 数据用 `JSON.stringify` 压缩
   - 构建时开启 gzip/brotli（Vite 自动处理）
4. **PWA 缓存**
   - 首次访问后，所有资源 + 数据被缓存
   - 后续访问 100% 本地，无需网络

---

## 📚 相关阅读

- [Comlink 官方文档](https://github.com/GoogleChromeLabs/comlink)
- [Vite PWA 插件](https://vite-pwa-org.netlify.app/)
- [Workbox 缓存策略](https://developer.chrome.com/docs/workbox/)
- [MTR 模组 Wiki](https://minecrafttransitrailway.fandom.com/)

---

## 🤝 贡献

发现 Bug 或有改进建议？欢迎提交 Issue 或 PR！
