/**
 * MTR Pathfinder - 数据类型定义（Worker 和主线程共享）
 *
 * 采用 Segment-Based 图模型：图的"边"（Segment）被当作一等公民
 * 这样可以精确追踪：从哪个站台出发、乘坐哪条线路、换乘时间等
 */

// ============ 交通工具类型 ============
export type TransportType =
  | 'train_normal'
  | 'train_light_rail'
  | 'train_high_speed'
  | 'boat_normal'
  | 'boat_light_rail'
  | 'boat_high_speed'
  | 'cable_car_normal'
  | 'airplane_normal'
  | 'walk'        // 站内步行/换乘
  | 'wait';       // 等待

// ============ 核心数据结构（Worker 使用） ============

/**
 * 车站：MTR 游戏中的 station 对象
 * 注意：一个车站可能包含多个站台
 */
export interface Station {
  index: number;           // 数组索引（O(1) 查找）
  id: string;              // MTR 内部 ID，如 "station_0"
  dim: string;             // 维度：overworld / nether / end
  name: string[];          // 多语言名称 ["中環", "Central", ...]
  pattern: string;         // 小写模式（用于搜索）
  color: string;           // 颜色 #rrggbb
  pos: { x: number; z: number };  // 游戏内坐标
  zone?: number;           // 区域/票价区
  connections: number[];   // 跨站换乘的车站索引
  platforms: number[];     // 本站所有站台索引
  routes: number[];        // 经过本站的线路索引
  next: number[];          // 从此站出发的 segment 索引
  prev: number[];          // 到此站结束的 segment 索引
}

/**
 * 站台：线路在某个车站的停靠位置
 * 同一线路两个方向是不同的站台
 */
export interface Platform {
  index: number;
  id: string;
  dim: string;
  station: number;         // 所属车站索引
  routes: number[];        // 经过此站台的线路索引
  pos: { x: number; z: number };
  vertical?: boolean;      // 是否垂直
  next: number[];          // 从此站台出发的 segment
  prev: number[];          // 到此站台结束的 segment
}

/**
 * 线路：MTR 游戏中的 route 对象
 */
export interface Route {
  index: number;
  id: string;              // 线路 ID (通常用 color 作为 ID)
  dim: string;
  name: string[];          // 多语言名称
  number: string[];        // 线路编号
  color: string;           // 十六进制颜色
  type: TransportType;     // 交通工具类型
  circular?: boolean;      // 是否环线
  stations: number[];      // 车站索引序列 [0, 15, 32, ...]
  platforms: number[];     // 站台索引序列（与 stations 对应）
  durations: number[];     // 站间运行时间（ticks），长度 = stations.length - 1
  densities: number[];     // 密度/流量信息（可选）
  pattern: string;         // 名称小写模式（搜索用）
}

/**
 * Segment：图的边（核心数据结构！）
 *
 * 三种类型的 segment：
 *   1. route segment:    站台A → 站台B（同一条线路）
 *   2. platform segment: 站台 → 车站（步行，上下车）
 *   3. station segment:  车站A → 车站B（出站换乘 / connections）
 */
export interface Segment {
  index: number;
  route: {
    type: TransportType | 'walk' | 'wait';
    index: number;        // -1 表示步行/等待
  };
  from: {
    type: 'station' | 'platform';
    index: number;
  };
  to: {
    type: 'station' | 'platform';
    index: number;
  };
  distance: number;       // 距离（blocks）
  duration: number;       // 时间（ticks）
  wait?: number;          // 额外等待时间（如换乘）
  prev: number[];         // 可能的前驱 segment 索引
  next: number[];         // 可能的后续 segment 索引
}

// ============ 完整数据集 ============
export interface TransitData {
  stations: Station[];
  platforms: Platform[];
  routes: Route[];
  segments: Segment[];
}

// ============ 路径规划结果 ============

export type PathMode = 'routes' | 'distance' | 'duration';

export interface PathStep {
  type: 'ride' | 'walk' | 'transfer';
  route?: { index: number; name: string; color: string };
  fromStation: { index: number; name: string };
  toStation: { index: number; name: string };
  fromPlatform?: { index: number; id: string };
  toPlatform?: { index: number; id: string };
  distance: number;
  duration: number;
  segments: number[];     // 原始 segment 索引链（调试用）
}

export interface PathResult {
  steps: PathStep[];
  totalDistance: number;
  totalDuration: number;
  transfers: number;
  stationCount: number;
  stationNames: string[];
}

// ============ 原始 MTR JSON 格式（用于解析） ============

export interface RawStation {
  id?: string;
  name: string;           // "中環|Central|..."
  color: number;          // 十进制颜色值
  x: number;
  z: number;
  connections?: string[]; // 可换乘的其他 station ID
  zone?: number;
}

export interface RawRoute {
  id?: string;
  name: string;           // "港島線||Island Line" (name||direction)
  color: number;
  type: string;           // TransportType 的字符串值
  stations: string[];     // station ID 序列
  durations?: number[];   // 站间时间（可选）
  densities?: number[];   // 密度（可选）
  number?: string;        // 线路编号 "1|1"
  circular?: boolean;
}

export interface RawPlatform {
  id?: string;            // 通常是 "stationId_platformNum"
  x: number;
  y: number;              // z in game
  vertical?: boolean;
}

export interface RawDimension {
  dim_id: string;         // "overworld" | "nether" | "end"
  stations: Record<string, RawStation>;
  routes: Record<string, RawRoute>;
  positions: Record<string, RawPlatform>;
}

export type RawData = RawDimension[];

// ============ 进度回调类型 ============
export type ProgressCallback = (progress: [number, string]) => void;
