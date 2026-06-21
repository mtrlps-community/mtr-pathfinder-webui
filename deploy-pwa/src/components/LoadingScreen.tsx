/**
 * 加载屏幕：在数据加载阶段显示进度
 *
 * Worker 中的加载分为几个阶段:
 *   0.0-0.5 → 获取数据 (fetch)
 *   0.5-1.0 → 数据转换 (transform stations/routes)
 *   1.0-1.8 → 构建 segments 图
 *   1.8-2.0 → 完成，渲染 UI
 */

interface LoadingScreenProps {
  progress: number;    // 0-2
  message: string;
  stats: {
    stationCount: number;
    platformCount: number;
    routeCount: number;
    segmentCount: number;
  };
}

export function LoadingScreen({ progress, message }: LoadingScreenProps) {
  const pct = Math.min(100, Math.round((progress / 2) * 100));

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-800 rounded-xl p-8 shadow-2xl text-center">
        <div className="text-6xl mb-4 animate-pulse">🚇</div>
        <h1 className="text-2xl font-bold text-white mb-2">MTR Pathfinder</h1>
        <p className="text-slate-400 text-sm mb-6">{message}</p>

        {/* 进度条 */}
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-rose-500 transition-all duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-sm text-slate-300 mb-8">{pct}%</div>

        {/* 阶段指示 */}
        <div className="grid grid-cols-4 gap-2 text-xs">
          {[
            { label: '获取数据', threshold: 0.2 },
            { label: '处理车站', threshold: 0.6 },
            { label: '构建线路', threshold: 1.2 },
            { label: '生成网络', threshold: 1.8 },
          ].map((phase, i) => {
            const done = progress >= phase.threshold;
            const active = !done && progress >= phase.threshold - 0.3;
            return (
              <div key={i} className="text-center">
                <div
                  className={`w-8 h-8 mx-auto mb-1 rounded-full flex items-center justify-center text-xs font-bold ${
                    done ? 'bg-green-600 text-white' : active ? 'bg-rose-500 text-white animate-pulse' : 'bg-slate-700 text-slate-500'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </div>
                <div className={`${done ? 'text-green-400' : 'text-slate-500'}`}>
                  {phase.label}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 text-xs text-slate-500 border-t border-slate-700 pt-4">
          ⚡ 路径计算在浏览器内完成 · 无需联网 · 支持离线使用
        </div>
      </div>
    </div>
  );
}
