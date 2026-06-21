/**
 * MTR Pathfinder - 数据类型定义
 * 
 * 说明: 将 Python 版数据结构映射到 TypeScript
 */

// ========== 车站 (Station) ==========
export interface Station {
  id: string;
  name: string;        // 可能包含 | 分隔的中文名|英文名
  chineseName?: string;
  englishName?: string;
  x: number;
  z: number;
  connections: string[];  // 换乘站的 station ID
}

// ========== 线路 (Route) ==========
export type TransportType =
  | 'train_normal'
  | 'train_light_rail'
  | 'train_high_speed'
  | 'boat_normal'
  | 'boat_light_rail'
  | 'boat_high_speed'
  | 'cable_car_normal'
  | 'airplane_normal';

export interface RouteStation {
  id: string;
  name: string;
  dwellTime?: number;  // ms
  platform?: string;
}

export interface Route {
  id: string;
  name: string;       // 中文|英文|...
  color: number;      // 十进制颜色值
  type: TransportType;
  stations: RouteStation[];
  durations: number[];   // 站间运行时间 (ms)
  circularState?: 'NONE' | 'CLOCKWISE' | 'ANTICLOCKWISE';
  circular?: 'cw' | 'ccw';
  number?: string;   // 线路编号
}

// ========== 完整数据 ==========
export interface TransitData {
  stations: Record<string, Station>;
  routes: Route[];
  // stationRoutes: Record<string, string[]>;  // station_id -> route_ids 经过此站的线路
  // 缓存版本
  version: string;
  updatedAt: number;
}

// ========== 寻路请求 ==========
export interface FindRouteRequest {
  start: string;
  end: string;
  algorithm?: 'default' | 'theory';
  onlyLines?: string[];     // 仅使用的线路名称
  ignoredLines?: string[];   // 禁用线路
  avoidStations?: string[];  // 避开的车站
  disableHighSpeed?: boolean;
  disableBoat?: boolean;
  enableWild?: boolean;
  onlyLrt?: boolean;
  detail?: boolean;
}

// ========== 寻路结果 ==========
export interface PathSegment {
  from: Station;
  to: Station;
  route?: Route;         // 乘坐的线路
  routeName: string;      // 显示用的线路名
  travelTime: number;       // 乘车时间 (秒)
  waitingTime?: number;    // 等待时间 (秒)
  terminus: string;        // 终点站/换乘站方向
  platform?: string;
}

export interface FindRouteResult {
  totalTime: number;
  totalStations: Station[];
  segments: PathSegment[];
  ridingTime: number;
  waitingTime: number;
  transfers: number;        // 换乘次数
}
