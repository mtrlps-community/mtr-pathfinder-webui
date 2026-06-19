# Cloudflare Workers 部署方案总览

> 本目录包含 2 种不同的方案，用于将 MTR Pathfinder 部署到 Cloudflare Workers。

## ⚠️ 重要: 为什么不能直接把 Python 代码部署到 Workers?

Workers 原生环境限制:
- **语言**: 仅支持 JavaScript/TypeScript (通过 V8 引擎)
- **CPU 时间**: 免费版 10ms / 付费版 50ms
- **文件系统**: 不可用（必须用 KV / R2）
- **C 扩展库**: `Pillow`、`networkx`、`OpenCC` 等无法运行
- **内存限制**: 128MB

因此需要以下方案之一:

---

## 📦 方案 A: 混合架构 (推荐 ⭐⭐⭐)

**位置**: [deploy-hybrid/](./deploy-hybrid/)

**核心思路**:
- 保留现有 Python 后端 (Docker 容器或 VPS)
- 用 Cloudflare Tunnel 把后端暴露到公网（无需公网 IP）
- 用 Cloudflare Workers 做边缘加速 + API 代理 + 缓存层

**优点**:
- ✅ 零代码改动
- ✅ 100% 功能完整 (图片生成/实时寻路/时刻表)
- ✅ 边缘加速，降低响应延迟

**缺点**:
- ❌ 需维护 Python 后端

---

## 🚀 方案 B: 纯 TypeScript Workers (Serverless)

**位置**: [deploy-pure-worker/](./deploy-pure-worker/)

**核心思路**:
- 用 TypeScript 重写核心逻辑 (Dijkstra 图算法)
- 用 Cloudflare KV 存储车站/线路数据
- 用 JS 替代库 (`opencc-js`, `@dagrejs/graphlib`)

**优点**:
- ✅ 完全无服务器，零运维
- ✅ 极低延迟 (全球边缘节点)
- ✅ 自动扩展

**缺点**:
- ❌ 需要重写代码
- ❌ 需要移除/替换 Python 特有功能 (Pillow 图片生成)
- ❌ 实时寻路算法需要调整以适应 CPU 限制

---

## 📋 选择哪一个方案?

| 场景 | 推荐方案 |
|-----|---------|
| 保留所有功能，零代码改动 | 方案 A (混合架构) |
| 追求完全 Serverless，接受功能精简 | 方案 B (纯 TS) |
| 已有服务器，想加速 | 方案 A |
| 新项目，没有遗留代码 | 方案 B |

---

## 🚀 快速开始（最推荐：方案 A）

```bash
# ========== 1. 启动 Python 后端 ==========
cd /workspace
docker build -t mtr-pathfinder .
docker run -d -p 5000:5000 mtr-pathfinder

# ========== 2. 暴露后端到公网 ==========
# 安装 Cloudflare Tunnel
curl -L --output cloudflared 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64'
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/

# 登录并创建隧道
cloudflared tunnel login
cloudflared tunnel create mtr-backend
cloudflared tunnel route dns mtr-backend mtr-api.your-domain.com
cloudflared tunnel run --url http://127.0.0.1:5000 mtr-backend &

# ========== 3. 部署 Workers 边缘层 ==========
cd /workspace/deploy-hybrid
npm install

# 编辑 wrangler.toml: 把 BACKEND_ORIGIN 改为你的隧道域名
# 把 MTR_CACHE 的 namespace ID 替换为你创建的

npm run deploy
```

---

## 📦 目录结构

```
/workspace
├── deploy-hybrid/              # 方案 A: 混合架构
│   ├── src/index.ts            #   Worker 主代码
│   ├── wrangler.toml           #   配置文件
│   ├── package.json
│   └── README.md               #   完整部署指南
├── deploy-pure-worker/         # 方案 B: 纯 TypeScript Workers
│   ├── src/
│   │   ├── index.ts            #   API 入口
│   │   ├── pathfinder.ts       #   Dijkstra 寻路算法
│   │   └── types.ts            #   数据类型
│   ├── scripts/
│   │   └── upload-to-kv.ts     #   数据上传脚本
│   ├── wrangler.toml
│   ├── package.json
│   └── README.md               #   完整部署指南
├── main.py                     # 原有 Python Flask 应用
├── Dockerfile                  # 原有 Docker 配置
└── README.md                   # 原有项目说明
```

---

## 🔧 其他部署方式（参考）

如果你对 Cloudflare Workers 不感兴趣，也可以考虑:

| 方式 | 适用场景 |
|-----|---------|
| **Docker 容器** + VPS | 已有服务器，简单直接 |
| **Cloudflare Pages** | 仅托管静态前端 |
| **Kubernetes** | 大规模部署 |
| **Cloud Run / Azure Functions** | Python 直接托管 |

---

## 📚 相关资源

- Cloudflare Workers 文档: https://developers.cloudflare.com/workers/
- Hono (Web 框架): https://hono.dev/
- Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- wrangler CLI: https://developers.cloudflare.com/workers/wrangler/

---

## 💡 常见问题

### Q1: 为什么不用 Pyodide (Python on WASM)?

A: 理论上可以，但以下库没有 WASM 版本:
- `Pillow` (图片生成) — 需替换为纯 JS 方案
- `networkx` (图算法) — 需重写为 TypeScript
- `OpenCC` (中文转换) — 可用 `opencc-js` 替代

即使替换成功，冷启动时间也会显著增加。

### Q2: 如何处理图片生成?

A: 两种方式:
- 方案 A: 保留 Python 后端生成图片
- 方案 B: 用 `@napi-rs/canvas` 或 `resvg-js` 在 Worker 内生成 SVG (需要较大工程投入)

### Q3: CPU 超时怎么办?

A: 对于大站图 (10000+ 站):
- 在算法中加入超时保护 (已实现: pathfinder.ts 中的 `timeLimitMs`)
- 使用 A* 算法替代 Dijkstra，加速启发式搜索
- 对图做预处理，分层搜索 (主干线 + 本地线)
- 预计算常用路径并存入 KV

### Q4: 费用如何?

A: 
- **免费套餐**: 每天 10 万次请求，10ms CPU 时间
- **付费套餐**: $5/月起，100 万次请求，50ms CPU 时间
- **KV 存储**: 前 1GB 免费，超出 $0.5/GB
- **出站带宽**: Cloudflare 网络内免费

对于大多数 MTR 服务器（日请求 < 1万），免费套餐足够。
