/* ==============================
 * GeoPath 类型定义
 * 地质路径规划测量系统的核心数据模型
 * ============================== */

/** 路径类型（预留扩展） */
export type GeoPathType = 'general';

/** 高程剖面数据 */
export interface ElevationProfile {
  /** 沿路径的累计距离数组（m） */
  distances: number[];
  /** 对应的高程数组（m） */
  elevations: number[];
  /** 最低高程 */
  minElevation: number;
  /** 最高高程 */
  maxElevation: number;
  /** 平均高程 */
  avgElevation: number;
  /** 累计爬升（m） */
  totalClimb: number;
  /** 累计下降（m） */
  totalDescent: number;
  /** 平均坡度（%） */
  avgGradient: number;
}

/** 路径测量结果 */
export interface PathMeasureResult {
  /** 每段距离（米） */
  segments: number[];
  /** 总距离（米） */
  total: number;
}

/** 地质路径 */
export interface GeoPath {
  id: string;
  name: string;
  type: GeoPathType;
  description: string;
  color: string;
  show: boolean;
  positions: import('cesium').Cartesian3[];
  measurements: PathMeasureResult;
  elevationProfile: ElevationProfile | null;
  createdAt: number;
}

/* ==============================
 * 轨迹播放配置
 * ============================== */

/** 轨迹播放配置 */
export interface PlaybackOptions {
  /** 默认速度 m/s */
  defaultSpeed: number;
  /** 是否显示尾迹 */
  showTrail: boolean;
  /** 尾迹保留点数 */
  trailLength: number;
  /** 第三人称跟随距离 (m) */
  thirdPersonDistance: number;
  /** 第三人称跟随高度 (m) */
  thirdPersonHeight: number;
  /** 第一人称视线高度偏移 (m) */
  firstPersonHeightOffset: number;
}

/** GeoJSON 序列化格式（用于导出/导入） */
export interface GeoPathJSON {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: {
      type: 'LineString';
      coordinates: number[][];
    };
    properties: {
      id: string;
      name: string;
      type: GeoPathType;
      description: string;
      color: string;
      totalDistance: number;
      createdAt: number;
    };
  }[];
}
