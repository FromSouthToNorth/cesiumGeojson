/* ==============================
 * 坡度分析类型定义
 * 从 geoPolygon.ts 独立，按关注点分离
 * ============================== */

/** 坡度分类 */
export type SlopeCategory = 'gentle' | 'moderate' | 'steep';

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
  /** 坡度分类（5°以下平缓，5-15°中等，15°以上陡峭） */
  category: SlopeCategory;
}

/** 坡度分析结果 */
export interface SlopeAnalysisResult {
  minSlope: number;
  maxSlope: number;
  avgSlope: number;
  medianSlope: number;
  minAngle: number;
  maxAngle: number;
  avgAngle: number;
  stdDevSlope: number;
  gentlePct: number;
  moderatePct: number;
  steepPct: number;
  minElevation: number;
  maxElevation: number;
  avgElevation: number;
  elevationRange: number;
  sampleCount: number;
  gridSpacing: number;
  gridPoints: SlopeGridPoint[];
}
