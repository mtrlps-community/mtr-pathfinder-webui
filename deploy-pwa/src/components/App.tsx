/**
 * 主应用组件
 *
 * 布局:
 *   ┌──────────────────────────────────────────────┐
 *   │  MTR Pathfinder                                │
 *   ├──────────────────────────────────────────────┤
 *   │                                               │
 *   │  📍 起点: [搜索框]                            │
 *   │  🏁 终点: [搜索框]                            │
 *   │  ⚙  模式: [最少换乘 ▼ | 最短距离 | 最短时间] │
 *   │                                               │
 *   │  [ 计算路径 ]  [ 浏览线路 ]  [ 浏览车站 ]     │
 *   │                                               │
 *   ├──────────────────────────────────────────────┤
 *   │  路径结果（steps）                           │
 *   │  - 线路 A: 车站1 → 车站2 → 车站3  (颜色块)   │
 *   │  ↓ 换乘                                       │
 *   │  - 线路 B: 车站3 → 车站4  (颜色块)           │
 *   │                                               │
 *   │  总距离: 1234 m | 总时间: 45 min | 换乘: 2   │
 *   └──────────────────────────────────────────────┘
 */

import React from 'react';
import { useData } from '../contexts/DataContext';
import { StationSearch } from './StationSearch';
import { PathResultCard } from './PathResultCard';
import { RoutesList } from './RoutesList';
import { StationsList } from './StationsList';
import { LoadingScreen } from './LoadingScreen';

type PathMode = 'routes' | 'distance' | 'duration';
type View = 'path' | 'routes' | 'stations';

export function App() {
  const data = useData();
  const [fromStation, setFromStation] = React.useState<{ index: number; id: string; name: string } | null>(null);
  const [toStation, setToStation] = React.useState<{ index: number; id: string; name: string } | null>(null);
  const [mode, setMode] = React.useState<PathMode>('distance');
  const [result, setResult] = React.useState<any | null>(null);
  const [computing, setComputing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [view, setView] = React.useState<View>('path');

  // 计算路径
  const compute = async () => {
    if (!fromStation || !toStation) {
      setError('请选择起点和终点');
      return;
    }
    if (fromStation.id === toStation.id) {
      setError('起点和终点不能相同');
      return;
    }
    setComputing(true);
    setError(null);
    setResult(null);
    try {
      const res = await data.calcPath([fromStation.name, toStation.name], mode);
      if (!res) {
        setError('没有找到可行路线');
      } else {
        setResult(res);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setComputing(false);
    }
  };

  // 加载状态
  if (data.loading && !data.error) {
    return <LoadingScreen progress={data.progress} message={data.progressMsg} stats={data} />;
  }

  if (data.error) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800 rounded-lg p-6 shadow-xl">
          <h1 className="text-2xl font-bold text-red-400 mb-4">加载失败</h1>
          <p className="text-slate-300 mb-4">{data.error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="bg-rose-800 py-6 px-4 shadow-lg">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-white tracking-wide">
            🚇 MTR Pathfinder
          </h1>
          <p className="text-rose-200 mt-1 text-sm">
            Minecraft Transit Railway 线路规划工具
          </p>
          <div className="mt-3 text-xs text-rose-200/80 flex gap-4">
            <span>车站: {data.stationCount.toLocaleString()}</span>
            <span>站台: {data.platformCount.toLocaleString()}</span>
            <span>线路: {data.routeCount.toLocaleString()}</span>
            <span>连接: {data.segmentCount.toLocaleString()}</span>
          </div>
        </div>
      </header>

      {/* Navigation tabs */}
      <nav className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-4xl mx-auto flex gap-1 px-4">
          {([
            { key: 'path', label: '🧭 路径规划' },
            { key: 'routes', label: '🔗 线路浏览' },
            { key: 'stations', label: '📍 车站一览' },
          ] as Array<{ key: View; label: string }>).map((t) => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                view === t.key
                  ? 'border-rose-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-4xl mx-auto p-4">
        {view === 'path' && (
          <div>
            {/* Input panel */}
            <div className="bg-slate-800 rounded-xl p-6 mb-6 shadow-xl">
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    📍 起点
                  </label>
                  <StationSearch
                    value={fromStation?.name || ''}
                    onSelect={setFromStation}
                    placeholder="输入车站名称..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    🏁 终点
                  </label>
                  <StationSearch
                    value={toStation?.name || ''}
                    onSelect={setToStation}
                    placeholder="输入车站名称..."
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    ⚙ 规划模式
                  </label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as PathMode)}
                    className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  >
                    <option value="distance">最短距离（推荐）</option>
                    <option value="duration">最短时间</option>
                    <option value="routes">最少换乘</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={compute}
                    disabled={computing}
                    className="flex-1 px-6 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors shadow-lg"
                  >
                    {computing ? '⏳ 计算中...' : '🚀 计算路径'}
                  </button>
                </div>
              </div>

              {error && (
                <div className="text-red-400 text-sm bg-red-900/30 px-4 py-2 rounded-lg border border-red-800/50">
                  ⚠ {error}
                </div>
              )}
            </div>

            {/* Result panel */}
            {result && <PathResultCard result={result} mode={mode} />}
            {!result && !computing && !error && (
              <div className="bg-slate-800/50 border border-dashed border-slate-600 rounded-xl p-8 text-center">
                <div className="text-5xl mb-4">🗺️</div>
                <h3 className="text-lg font-semibold text-slate-300 mb-2">开始规划</h3>
                <p className="text-slate-400 text-sm">
                  选择起点和终点，然后点击"计算路径"查找最佳路线
                </p>
              </div>
            )}
          </div>
        )}

        {view === 'routes' && <RoutesList />}
        {view === 'stations' && <StationsList />}
      </main>

      {/* Footer */}
      <footer className="mt-12 py-6 text-center text-slate-500 text-sm border-t border-slate-800">
        <p>MTR Pathfinder · 基于 Web Worker 的前端计算 · PWA 可离线使用</p>
        <p className="mt-1 text-xs">数据来源: Minecraft Transit Railway mod</p>
      </footer>
    </div>
  );
}
