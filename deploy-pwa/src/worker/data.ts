/**
 * Comlink Worker 代理：在主线程中调用 Worker 函数，如同调用普通函数
 *
 * 使用示例:
 *   import { dataWorker } from './data';
 *   await dataWorker.load('/data/stations_routes.json');
 *   const result = await dataWorker.calcPath(['中央站', '机场站'], 'duration');
 */

// @ts-ignore - vite-plugin-comlink 提供的特殊语法
import * as ComlinkWorkerModule from 'comlink:./data.worker';
import { proxy } from 'comlink';

// 重新导出类型（方便在 React 组件中使用）
export type {
  Station,
  Platform,
  Route,
  Segment,
  TransitData,
  PathMode,
  PathResult,
  PathStep,
  ProgressCallback,
} from '../../definitions/worker';

// ComlinkWorkerModule.default 是 Worker 实例，Comlink 自动处理 RPC
export const dataWorker = ComlinkWorkerModule.default;

// 方便使用：进度回调的 proxy 包装
export function makeProgressCallback(cb: (pct: number, msg: string) => void) {
  return proxy(([pct, msg]: [number, string]) => cb(pct, msg));
}
