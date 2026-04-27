/* ==============================
 * GeoPolygon 类型定义
 * 多边形地质勘测系统的核心数据模型
 * ============================== */

/** 坡度分类 */
export type SlopeCategory = 'gentle' | 'moderate' | 'steep';

/** 多边形测量结果 */
export interface GeoPolygonMeasureResult {
  /** 各边 geodesic 距离（m），包含闭合边 */
  segments: number[];
  /** 总周长（m） */
  perimeter: number;
  /** 封闭面积（m²） */
  area: number;
}

/** 地质勘测多边形 */
export interface GeoPolygon {
  id: string;
  name: string;
  description: string;
  color: string;
  show: boolean;
  positions: import('cesium').Cartesian3[];
  measurements: GeoPolygonMeasureResult;
  /** 各顶点的地形高程（海拔，米），采样后填充 */
  vertexElevations?: number[];
  /** 是否启用地形裁切 */
  clipping?: boolean;
  createdAt: number;
}

/** 坡度分析结果中的单个网格点 */
export interface SlopeGridPoint {
  /** 经度 (rad) */
  lon: number;
  /** 纬度 (rad) */
  lat: number;
  /** 地形高程 (m) */
  height: number;
  /** 坡度百分比 */
  slope: number;
  /** 坡度角度 (°) */
  angle: number;
  /** 坡度分类（基于角度，5°以下平缓，5-15°中等，15°以上陡峭） */
  category: SlopeCategory;
}

/** 坡度分析结果 */
export interface SlopeAnalysisResult {
  /** 最小坡度 (%) */
  minSlope: number;
  /** 最大坡度 (%) */
  maxSlope: number;
  /** 平均坡度 (%) */
  avgSlope: number;
  /** 中位坡度 (%) */
  medianSlope: number;
  /** 最小坡度角 (°) */
  minAngle: number;
  /** 最大坡度角 (°) */
  maxAngle: number;
  /** 平均坡度角 (°) */
  avgAngle: number;
  /** 标准差 */
  stdDevSlope: number;
  /** 平缓占比（角度 < 5°） */
  gentlePct: number;
  /** 中等占比（5° ≤ 角度 < 15°） */
  moderatePct: number;
  /** 陡峭占比（角度 ≥ 15°） */
  steepPct: number;
  /** 最低高程 (m) */
  minElevation: number;
  /** 最高高程 (m) */
  maxElevation: number;
  /** 平均高程 (m) */
  avgElevation: number;
  /** 高程起伏 (m) */
  elevationRange: number;
  /** 有效采样点数 */
  sampleCount: number;
  /** 采样网格间距 (m) */
  gridSpacing: number;
  /** 各网格点的坡度数据（用于地图着色） */
  gridPoints: SlopeGridPoint[];
}

/** GeoJSON 序列化格式（用于导出） */
export interface GeoPolygonJSON {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: {
      type: 'Polygon';
      coordinates: number[][][];
    };
    properties: {
      id: string;
      name: string;
      description?: string;
      color: string;
      area: number;
      perimeter: number;
      vertexElevations?: number[];
      clipping?: boolean;
      createdAt: number;
    };
  }[];
}
