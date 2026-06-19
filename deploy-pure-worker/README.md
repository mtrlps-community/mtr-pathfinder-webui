# 纯 Workers 方案 —— 100% TypeScript 无服务器

> 完全重写为 TypeScript，**无需 Python 后端**。但图片生成、实时时刻表等功能需要替换或移除。

## 架构

```
                    ┌──────────────────────┐
                    │  Cloudflare Edge     │
                    │   (Hono + Workers)   │
                    └──────┬───────────────┘
                           │
              ┌────────────┴─────────────┐
              │                          │
     ┌────────▼────────┐        ┌────────▼────────┐
     │   KV 数据存储    │        │  CPU: 寻路计算   │
     │  车站/线路数据    │        │  (Dijkstra + 堆) │
     └─────────────────┘        └─────────────────┘
              |
              ▼
     ┌─────────────────┐
     │   R2 (可选)      │
     │  预生成的图片     │
     └─────────────────┘
```

## 与 Python 版的功能对比

| 功能 | Python 版 | TypeScript Workers 版 |
|-----|----------|----------------------|
| 车站搜索 | ✅ | ✅ (更快, KV 缓存) |
| 线路信息 | ✅ | ✅ |
| 理论寻路 (Dijkstra) | ✅ | ✅ |
| 实时寻路 (CSA) | ✅ | ⚠️ 需要时刻表数据 |
| 寻路结果图片 | ✅ Pillow | ❌ (移除，用 SVG/Canvas 替代) |
| 时刻表 | ✅ | ⚠️ 需另行存储 |
| 中文繁简转换 | ✅ OpenCC | ✅ `opencc-js` |
| 字体处理 | ✅ fonttools | ❌ (移除) |
| 缓存 | ✅ pickle/文件 | ✅ KV + CDN |

## 快速开始

### 步骤 1: 准备数据

```bash
# 先确保 Python 后端正在运行
curl http://localhost:5000/api/stations_routes_data

# 从后端抓取数据并保存
cd /workspace/deploy-pure-worker
npm install
npx ts-node scripts/upload-to-kv.ts

# 手动上传到 KV (替换 YOUR_KV_ID)
npx wrangler kv:key put --binding=MTR_DATA \
  --namespace-id=YOUR_KV_ID \
  data:v1 "$(cat data.json)"
```

### 步骤 2: 配置和部署

编辑 `wrangler.toml`:
```toml
name = "mtr-pathfinder-pure"

[[kv_namespaces]]
binding = "MTR_DATA"
id = "YOUR_KV_ID"
```

部署:
```bash
npm run dev     # 本地测试
npm run deploy  # 部署到 Cloudflare
```

测试:
```bash
# 健康检查
curl https://your-worker.your-account.workers.dev/

# 搜索车站
curl "https://your-worker.your-account.workers.dev/api/search_stations?q=中央"

# 寻路
curl -X POST "https://your-worker.your-account.workers.dev/api/find_route" \
  -H "Content-Type: application/json" \
  -d '{"start": "中央站", "end": "机场站"}'
```

## Workers 限制与优化

### CPU 时间限制
- 免费套餐: 10ms
- 付费套餐: 50ms
- **本方案已实现**: 算法中内置超时保护 (默认 30ms)
- **大站图 (>5000 站)**: 可能需要以下优化:

### 建议优化

#### 1. 预计算常用路径
```
常用站对 → 预计算路径 → 存入 KV
```

#### 2. 分层图
```
大交通网络: 高速线主干图 + 普通线子图
```

#### 3. 缓存所有查询结果
```
每次计算 → 写入 KV (TTL 24h) → 下次直接读缓存
```

## API 文档

### `GET /` — 健康检查
```json
{
  "ok": true,
  "service": "MTR Pathfinder",
  "dataVersion": "v1",
  "stationCount": 1234,
  "routeCount": 56,
  "updatedAt": 1710000000000
}
```

### `GET /api/search_stations?q=中央` — 车站搜索
```json
["中央车站", "中央公园站", ...]
```

### `POST /api/find_route` — 寻路
**请求体**:
```json
{
  "start": "中央车站",
  "end": "机场站",
  "algorithm": "theory",
  "disableHighSpeed": false,
  "disableBoat": false,
  "enableWild": false,
  "avoidStations": []
}
```

**响应**:
```json
{
  "result": {
    "totalTime": 360,
    "stationNames": ["中央车站", "市中心站", "换乘站", "机场站"],
    "segments": [
      {
        "from": "中央车站",
        "to": "换乘站",
        "route": "1号线",
        "routeColor": "#ff0000",
        "travelTime": 180
      },
      {
        "from": "换乘站",
        "to": "机场站",
        "route": "机场快线",
        "routeColor": "#0000ff",
        "travelTime": 180
      }
    ],
    "ridingTime": 360,
    "waitingTime": 0,
    "transfers": 1
  },
  "algorithm": "theory",
  "engine": "typescript-worker"
}
```

### `GET /api/stations` — 车站列表
### `GET /api/routes` — 线路列表
### `GET /api/stations/:id` — 车站详情
### `GET /api/routes/:id` — 线路详情

## 后续扩展方向

### 1. 添加图片生成（需要 WASM 版图像处理库）
```
方案: 使用 @napi-rs/canvas 或 resvg-js 在 Worker 内生成 SVG/PNG
难度: 中 → 需处理字体渲染问题
```

### 2. 添加实时时刻表
```
方案: 从 MTR Online API 拉取时刻表 → 存入 KV
难度: 中 → 需定时 Cron 更新
```

### 3. 前端页面
```
方案: 用 Cloudflare Pages + React 构建前端
参考: 项目的 templates/index.html 作为起点
```

## 与混合架构方案的抉择

| 维度 | 混合架构 (推荐) | 纯 Workers |
|-----|---------------|----------|
| 部署复杂度 | 低 | 中 |
| 功能完整度 | 100% | ~70% |
| 运维成本 | 需维护后端 | 纯 Serverless |
| 响应速度 | 一般 (要回源) | 快 |
| 扩展性 | 高 | 受限于 Workers |

**结论**: 如果你不需要图片生成和实时时刻表，纯 Workers 版更简洁。否则使用混合架构。
