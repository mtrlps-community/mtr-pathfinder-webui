/**
 * DataContext: 管理 MTR 数据的加载和状态
 *
 * - 在应用启动时初始化 Web Worker
 * - 从服务器获取 JSON 数据（或使用本地 JSON）
 * - 为所有组件提供统一的数据访问接口
 * - 管理加载状态和错误
 */

import React from 'react';
import { dataWorker, makeProgressCallback, type PathMode, type PathResult } from '../worker/data';

interface DataState {
  loading: boolean;
  progress: number;          // 0-2，消息对应的进度
  progressMsg: string;       // 加载消息
  error: string | null;
  stations: Array<{ index: number; id: string; name: string; color: string }>;
  routes: Array<{
    index: number;
    id: string;
    name: string;
    color: string;
    type: string;
    stationCount: number;
  }>;
  stationCount: number;
  platformCount: number;
  routeCount: number;
  segmentCount: number;
}

interface DataContextValue extends DataState {
  // 路径规划
  calcPath: (stationNames: string[], mode: PathMode) => Promise<PathResult | null>;
  // 车站搜索
  searchStations: (query: string) => Promise<Array<{ index: number; id: string; name: string }>>;
  // 线路详情
  getRouteDetails: (idx: number) => Promise<any>;
}

const initialState: DataState = {
  loading: true,
  progress: 0,
  progressMsg: '初始化...',
  error: null,
  stations: [],
  routes: [],
  stationCount: 0,
  platformCount: 0,
  routeCount: 0,
  segmentCount: 0,
};

export const DataContext = React.createContext<DataContextValue>({
  ...initialState,
  calcPath: async () => null,
  searchStations: async () => [],
  getRouteDetails: async () => null,
});

// ========================================
// Provider 组件
// ========================================
export function DataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<DataState>(initialState);

  // 启动时加载数据
  React.useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        // 进度回调：worker 中的 long-running 操作会定期回调
        const progressCb = makeProgressCallback((pct: number, msg: string) => {
          if (!cancelled) {
            setState((s) => ({ ...s, progress: pct, progressMsg: msg }));
          }
        });

        // 从静态资源加载数据（打包时放在 public/data/）
        await dataWorker.load('/data/stations_routes.json', progressCb);

        if (cancelled) return;

        // 获取元数据和列表
        const [stats, stations, routes] = await Promise.all([
          dataWorker.stats(),
          dataWorker.getAllStations(),
          dataWorker.getAllRoutes(),
        ]);

        if (cancelled) return;

        setState({
          loading: false,
          progress: 2,
          progressMsg: '就绪',
          error: null,
          stations,
          routes,
          stationCount: stats.stations,
          platformCount: stats.platforms,
          routeCount: stats.routes,
          segmentCount: stats.segments,
        });
      } catch (e) {
        console.error('数据加载失败:', e);
        if (!cancelled) {
          setState((s) => ({
            ...s,
            loading: false,
            error: (e as Error).message,
            progressMsg: '加载失败',
          }));
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  // 暴露给组件的方法
  const value: DataContextValue = {
    ...state,
    calcPath: (stationNames, mode) => dataWorker.calcPath(stationNames, mode),
    searchStations: (query) => dataWorker.searchStations(query),
    getRouteDetails: (idx) => dataWorker.getRouteDetails(idx),
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

// ========================================
// Hook 便捷 API
// ========================================
export function useData(): DataContextValue {
  return React.useContext(DataContext);
}
