/**
 * 数据上传脚本：
 *   1. 从 Python 后端拉取 JSON 数据
 *   2. 转换为 TypeScript Worker 可用的格式
 *   3. 上传到 Cloudflare KV
 * 
 * 使用:
 *   npx ts-node scripts/upload-to-kv.ts
 *   # 或
 *   npm run data:upload
 * 
 * 前置条件:
 *   - Python 后端正在运行 (http://localhost:5000)
 *   - 已配置 wrangler 和 Cloudflare 账号
 */

import * as fs from 'fs';
import * as path from 'path';

// ============ 1. 从本地 Python 后端抓取数据
async function fetchFromBackend(backendUrl: string = 'http://localhost:5000') {
  console.log('正在从', backendUrl, '拉取数据...');

  const [stations, routes, timetable] = await Promise.all([
    fetch(`${backendUrl}/api/stations_routes_data`, { cache: 'no-store' }).then(r => r.json()),
    fetch(`${backendUrl}/api/stations_routes_data`, { cache: 'no-store' }).then(r => r.json()),
    fetch(`${backendUrl}/api/timetable`, { method: 'POST', body: JSON.stringify({}) }).then(r => r.json()),
  ]);

  console.log('✅ 数据拉取完成');
  return { stations, routes, timetable };
}

// ============ 2. 规范化数据
function normalizeData(raw: any) {
  // 根据实际 Python 后端返回的格式可能不同，这里提供一个通用的规范化函数
  return {
    stations: {},
    routes: [],
    updatedAt: Date.now(),
    ...raw,
  };
}

// ============ 3. 本地保存（调试用）
function saveLocal(data: any, filepath: string = 'data.json') {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log('✅ 已保存到', filepath);
}

// ============ 主流程
(async () => {
  try {
    const raw = await fetchFromBackend(process.env.BACKEND_URL || 'http://localhost:5000');
    const data = normalizeData(raw);
    saveLocal(data, path.join(__dirname, '..', 'data.json');

    console.log('📌 下一步:');
    console.log('  1. 使用 wrangler 上传到 KV:');
    console.log('     npx wrangler kv:key put --binding=MTR_DATA data:v1 "$(cat data.json)"');
    console.log('  2. 或者在 Cloudflare Dashboard 上传');
    console.log('  3. npm run deploy');

  } catch (err) {
    console.error('❌ 失败:', err);
    process.exit(1);
  }
})();
