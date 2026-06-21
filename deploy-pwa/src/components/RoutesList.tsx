/**
 * 线路列表：浏览所有线路，可展开查看详细站点
 */

import React from 'react';
import { useData } from '../contexts/DataContext';

export function RoutesList() {
  const data = useData();
  const [expanded, setExpanded] = React.useState<number | null>(null);
  const [details, setDetails] = React.useState<any>(null);
  const [filter, setFilter] = React.useState('');

  // 加载展开的线路详情
  React.useEffect(() => {
    if (expanded === null) {
      setDetails(null);
      return;
    }
    data.getRouteDetails(expanded).then((d) => setDetails(d));
  }, [expanded, data]);

  // 过滤
  const filtered = React.useMemo(() => {
    if (!filter) return data.routes;
    const q = filter.toLowerCase();
    return data.routes.filter((r) => r.name.toLowerCase().includes(q) || r.id.includes(q));
  }, [filter, data.routes]);

  return (
    <div>
      <div className="mb-4">
        <input
          type="text"
          placeholder="🔍 搜索线路名称..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500"
        />
      </div>

      <div className="grid gap-2">
        {filtered.map((route) => (
          <div
            key={route.index}
            className="bg-slate-800 rounded-lg overflow-hidden border border-slate-700"
          >
            <button
              onClick={() => setExpanded(expanded === route.index ? null : route.index)}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-700/50 transition-colors text-left"
            >
              <span
                className="w-6 h-6 rounded-sm shrink-0"
                style={{ backgroundColor: route.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-white font-medium truncate">{route.name}</div>
                <div className="text-xs text-slate-400">
                  {route.stationCount} 站 · {route.type}
                </div>
              </div>
              <span className="text-slate-400 text-sm">
                {expanded === route.index ? '▾' : '▸'}
              </span>
            </button>

            {expanded === route.index && (
              <div className="px-4 py-3 bg-slate-850 border-t border-slate-700">
                {!details ? (
                  <div className="text-slate-400 text-sm py-4 text-center">加载中...</div>
                ) : (
                  <div>
                    <div className="mb-3 text-xs text-slate-400">
                      共 {details.stations?.length || 0} 站 · 总时间约{' '}
                      {Math.round((details.totalDuration || 0) / 1200)} 分钟
                    </div>
                    <div className="relative pl-6">
                      {details.stations?.map((st: any, i: number) => (
                        <div key={st.id} className="relative pb-3 last:pb-0">
                          {/* 时间轴 */}
                          <div
                            className="absolute left-0 top-2 w-3 h-3 rounded-full -translate-x-1.5 border-2 border-slate-800"
                            style={{ backgroundColor: route.color }}
                          />
                          {i < (details.stations?.length ?? 0) - 1 && (
                            <div
                              className="absolute left-0 top-5 bottom-0 w-0.5 -translate-x-0.5"
                              style={{ backgroundColor: route.color, opacity: 0.4 }}
                            />
                          )}
                          <div className="text-slate-200 text-sm">{st.name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-slate-400 text-center py-8">没有找到匹配的线路</div>
      )}
    </div>
  );
}
