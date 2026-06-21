/**
 * 车站搜索输入框 - 支持模糊搜索和自动补全
 */

import React from 'react';
import { useData } from '../contexts/DataContext';

interface StationItem {
  index: number;
  id: string;
  name: string;
}

interface Props {
  value: string;
  onSelect: (station: StationItem) => void;
  placeholder?: string;
}

export function StationSearch({ value, onSelect, placeholder }: Props) {
  const data = useData();
  const [query, setQuery] = React.useState(value);
  const [suggestions, setSuggestions] = React.useState<StationItem[]>([]);
  const [showDropdown, setShowDropdown] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const debounceTimer = React.useRef<number | null>(null);

  // 外部 value 更新
  React.useEffect(() => {
    setQuery(value);
  }, [value]);

  // 模糊搜索（防抖 200ms）
  React.useEffect(() => {
    if (!query || query.length < 1) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);

    debounceTimer.current = window.setTimeout(async () => {
      try {
        const results = await data.searchStations(query);
        setSuggestions(results.slice(0, 10));
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => {
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    };
  }, [query, data]);

  const handleSelect = (s: StationItem) => {
    setQuery(s.name);
    setSuggestions([]);
    setShowDropdown(false);
    onSelect(s);
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setShowDropdown(true);
        }}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        placeholder={placeholder}
        className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
      />

      {showDropdown && query.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-72 overflow-y-auto">
          {loading && (
            <div className="px-4 py-3 text-slate-400 text-sm">
              搜索中...
            </div>
          )}

          {!loading && suggestions.length === 0 && (
            <div className="px-4 py-3 text-slate-400 text-sm">
              没有找到匹配的车站
            </div>
          )}

          {!loading && suggestions.length > 0 && (
            <ul>
              {suggestions.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseDown={() => handleSelect(s)}
                    className="w-full px-4 py-2.5 text-left hover:bg-slate-700 transition-colors text-sm"
                    style={{
                      borderLeft: `3px solid ${
                        // 根据 index 生成伪随机颜色
                        `#${((s.index * 16777213) % 0xffffff).toString(16).padStart(6, '0')}`
                      }`,
                    }}
                  >
                    {highlight(s.name, query)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// 高亮匹配的子串
function highlight(text: string, query: string) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-rose-700/50 text-rose-200 rounded px-0.5">
        {text.slice(idx, idx + q.length)}
      </span>
      {text.slice(idx + q.length)}
    </>
  );
}
