/* ==============================
 * GeoPolygon 类型定义
 * 多边形地质勘测系统的核心数据模型
 * ============================== */

import type { Cartesian3 } from 'cesium';

/** 多边形测量结果 */
export interface GeoPolygonMeasureResult {
  segments: number[];
  perimeter: number;
  area: number;
}

/** 地质勘测多边形 */
export interface GeoPolygon {
  id: string;
  name: string;
  description: string;
  color: string;
  show: boolean;
  positions: Cartesian3[];
  measurements: GeoPolygonMeasureResult;
  vertexElevations?: number[];
  clipping?: boolean;
  createdAt: number;
}

/** GeoJSON 导出格式 */
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
