/**
 * 车站列表：查看所有车站，支持搜索
 */

import React from 'react';
import { useData } from '../contexts/DataContext';

export function StationsList() {
  const data = useData();
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    if (!query) return data.stations;
    const q = query.toLowerCase();
    return data.stations.filter(
      (s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
    );
  }, [query, data.stations]);

  return (
    <div>
      <div className="mb-4">
        <input
          type="text"
          placeholder="🔍 搜索车站..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500"
        />
      </div>

      <div className="bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
        <div className="grid grid-cols-1 divide-y divide-slate-700">
          {filtered.map((station, i) => (
            <div key={station.id} className="px-4 py-3 flex items-center gap-3 hover:bg-slate-700/50">
              <span className="text-xs text-slate-500 w-10">#{i + 1}</span>
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: station.color || '#888' }}
              />
              <span className="text-white text-sm">{station.name}</span>
              <span className="text-xs text-slate-500 ml-auto font-mono">{station.id}</span>
            </div>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="text-slate-400 text-center py-8">没有找到匹配的车站</div>
      )}

      <div className="mt-4 text-xs text-slate-500 text-center">
        显示 {filtered.length.toLocaleString()} / 共 {data.stations.length.toLocaleString()} 个车站
      </div>
    </div>
  );
}
