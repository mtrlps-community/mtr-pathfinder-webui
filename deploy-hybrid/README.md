# 混合架构方案 (推荐) —— Cloudflare Workers + Python 后端

> **零代码改动**，保留原有的图片生成、实时时刻表等功能。

## 架构

```
                    ┌──────────────────────┐
                    │  Cloudflare Edge     │
                    │   (Workers/Pages)    │
                    └──────┬───────────────┘
                           │
              ┌────────────┴─────────────┐
              │                          │
  ┌───────────▼──────────┐    ┌──────────▼────────────┐
  │  静态资源 (CDN缓存)  │    │   API 请求 → 反向代理  │
  │   HTML/CSS/JS/图片   │    │      到 Python 后端   │
  └──────────────────────┘    └──────────┬────────────┘
                                         │
                              ┌──────────▼────────────┐
                              │  Cloudflare Tunnel    │
                              │  (或其他暴露方式)     │
                              └──────────┬────────────┘
                                         │
                              ┌──────────▼────────────┐
                              │  Python Flask 应用    │
                              │  (Docker 容器 / VPS)  │
                              │  含 Pillow/networkx   │
                              └───────────────────────┘
```

## 步骤 1: 启动 Python 后端

```bash
# 使用项目自带的 Dockerfile
cd /workspace
docker build -t mtr-pathfinder .
docker run -d -p 5000:5000 --name mtr-backend mtr-pathfinder

# 或直接运行
python main.py
```

测试:
```bash
curl http://localhost:5000/api/search_stations?q=中央
```

## 步骤 2: 用 Cloudflare Tunnel 暴露后端 (无需公网 IP)

```bash
# 安装
brew install cloudflared  # macOS
# Linux:
curl -L --output cloudflared 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64'
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/

# 登录（会弹出浏览器或提供链接）
cloudflared tunnel login

# 创建隧道
cloudflared tunnel create mtr-backend

# 将子域名指向隧道
cloudflared tunnel route dns mtr-backend mtr-api.your-domain.com

# 启动隧道（连接到本地 5000 端口）
cloudflared tunnel run --url http://127.0.0.1:5000 mtr-backend
```

## 步骤 3: 配置并部署 Workers

```bash
cd /workspace/deploy-hybrid
npm install

# 编辑 wrangler.toml，设置:
#   - BACKEND_ORIGIN = "https://mtr-api.your-domain.com"
#   - MTR_CACHE 的 KV 命名空间 ID (先在 Cloudflare Dashboard 创建)

# 本地测试
npm run dev

# 部署
npm run deploy
```

## 步骤 4: 创建 KV 命名空间

```bash
# 创建
npx wrangler kv:namespace create MTR_CACHE

# 把返回的 ID 填入 wrangler.toml 的 [[kv_namespaces]]
```

## 功能说明

| 功能 | 是否由 Worker 处理 | 说明 |
|-----|-------------------|------|
| 车站搜索 | ✅ + KV 缓存 | 优先从 KV 缓存搜索，未命中则回源 |
| 寻路计算 | ⚠️ 仅转发 | 实际计算在 Python 后端 |
| 图片生成 | ⚠️ 仅转发 | Pillow 在 Python 后端生成 |
| 线路浏览 | ✅ + KV 缓存 | 页面级缓存 |
| 时刻表 | ⚠️ 仅转发 | 实时数据不缓存 |
| 管理后台 | ⚠️ 仅转发 | 依赖原有的密码验证 |

## 缓存策略

```
资源类型         | TTL    | 缓存层级
─────────────────────────────────
静态资源(js/css)  | 7 天   | Cloudflare CDN
车站/线路列表     | 24 小时 | KV + CDN
寻路结果(非实时)  | 1 小时 | KV 缓存
寻路结果(实时)    | 60 秒  | CDN
API 错误响应      | 1 秒   | 不缓存
```

## 监控和调试

```bash
# 查看实时日志
npx wrangler tail

# 查看 Worker 指标
# 访问 Cloudflare Dashboard → Workers & Pages → 选择 Worker → Analytics
```

## 常见问题

**Q: Worker 返回 503 错误?**
A: 检查 Python 后端是否在运行，BACKEND_ORIGIN 是否正确配置。

**Q: 图片生成很慢?**
A: 这是预期的，因为实际计算仍在 Python 后端。可以考虑：
   - 把常用寻路结果的图片预先生成，放到 R2 对象存储
   - 在 Worker 中设置更长的超时（Cron 触发）

**Q: 想完全无服务器?**
A: 看 [deploy-pure-worker](../deploy-pure-worker) 方案。但图片生成等功能需要移除或改用 JS 库。
