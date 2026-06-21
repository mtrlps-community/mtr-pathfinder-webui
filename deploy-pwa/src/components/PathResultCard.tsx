/**
 * 路径结果展示卡片
 *
 * 显示 steps，每个 step 用不同颜色表示不同线路
 * 步行换乘段用灰色/虚线表示
 */

interface PathResultCardProps {
  result: {
    steps: Array<{
      type: 'ride' | 'walk' | 'transfer';
      route?: { name: string; color: string };
      fromStation: { name: string };
      toStation: { name: string };
      distance: number;
      duration: number;
    }>;
    totalDistance: number;
    totalDuration: number;
    transfers: number;
    stationCount: number;
    stationNames: string[];
  };
  mode: string;
}

export function PathResultCard({ result, mode }: PathResultCardProps) {
  const formatDistance = (meters: number) => {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${meters} m`;
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds} 秒`;
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return sec > 0 ? `${min} 分 ${sec} 秒` : `${min} 分钟`;
  };

  const modeLabel: Record<string, string> = {
    routes: '最少换乘',
    distance: '最短距离',
    duration: '最短时间',
  };

  return (
    <div className="bg-slate-800 rounded-xl shadow-xl overflow-hidden">
      {/* 摘要 */}
      <div className="bg-slate-700/50 p-5 border-b border-slate-600">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs uppercase tracking-wide px-2 py-1 bg-rose-700 text-rose-100 rounded">
            {modeLabel[mode] || mode}
          </span>
          <h2 className="text-xl font-bold text-white">路径规划结果</h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <StatBlock label="总距离" value={formatDistance(result.totalDistance)} icon="📏" />
          <StatBlock label="预计时间" value={formatDuration(result.totalDuration)} icon="⏱" />
          <StatBlock label="换乘次数" value={`${result.transfers} 次`} icon="🔄" />
          <StatBlock label="经过车站" value={`${result.stationCount} 站`} icon="🚉" />
        </div>
      </div>

      {/* Steps 时间轴 */}
      <div className="p-5">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">详细路线</h3>

        <div className="relative">
          {result.steps.length === 0 && (
            <div className="text-slate-400 text-sm text-center py-4">
              没有详细步骤信息
            </div>
          )}

          {result.steps.map((step, i) => (
            <div key={i} className="relative pl-8 pb-6 last:pb-0">
              {/* 时间轴圆点 / 竖线 */}
              {step.type === 'ride' ? (
                <>
                  <div
                    className="absolute left-2 top-1.5 w-4 h-4 rounded-full border-2 border-white shadow-md"
                    style={{ backgroundColor: step.route?.color || '#888' }}
                  />
                  <div
                    className="absolute left-[11px] top-5 bottom-0 w-1.5"
                    style={{ backgroundColor: step.route?.color || '#888' }}
                  />
                </>
              ) : (
                <>
                  <div className="absolute left-2 top-1.5 w-4 h-4 rounded-full bg-slate-500 border-2 border-dashed border-slate-400" />
                  <div className="absolute left-[11px] top-5 bottom-0 w-1.5 border-l-2 border-dashed border-slate-500" />
                </>
              )}

              {/* 内容 */}
              <div
                className={`rounded-lg p-3 ${
                  step.type === 'ride' ? 'bg-slate-700/70' : 'bg-slate-700/30 border border-slate-600 border-dashed'
                }`}
              >
                {step.type === 'ride' ? (
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span
                        className="inline-block w-3 h-3 rounded-sm"
                        style={{ backgroundColor: step.route?.color || '#888' }}
                      />
                      <span className="font-semibold text-white text-sm">
                        {step.route?.name || '线路'}
                      </span>
                      <span className="text-xs text-slate-400">· 乘车</span>
                    </div>
                    <div className="text-slate-200 text-sm">
                      <span>{step.fromStation.name}</span>
                      <span className="text-slate-500 mx-2">→</span>
                      <span>{step.toStation.name}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {formatDistance(step.distance)} · {formatDuration(step.duration)}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="text-slate-200 text-sm mb-1">
                      🚶 <span className="font-semibold">步行换乘</span>
                    </div>
                    <div className="text-slate-300 text-sm">
                      {step.fromStation.name} → {step.toStation.name}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {formatDistance(step.distance)} · {formatDuration(step.duration)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 途径所有站点 */}
        {result.stationNames.length > 0 && (
          <div className="mt-6 pt-4 border-t border-slate-700">
            <h3 className="text-sm font-semibold text-slate-300 mb-2">沿途站点</h3>
            <div className="text-sm text-slate-400 flex flex-wrap gap-x-2 gap-y-1">
              {result.stationNames.map((name, i) => (
                <React.Fragment key={i}>
                  <span className="text-slate-200">{name}</span>
                  {i < result.stationNames.length - 1 && <span className="text-slate-600">›</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBlock({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="bg-slate-700 rounded-lg p-3 text-center">
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-white font-bold text-sm">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}
