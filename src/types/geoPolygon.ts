/* ==============================
 * GeoPolygon 类型定义
 * 多边形地质勘测系统的核心数据模型
 * ============================== */

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
  color: string;
  show: boolean;
  positions: import('cesium').Cartesian3[];
  measurements: GeoPolygonMeasureResult;
  /** 各顶点的地形高程（海拔，米），采样后填充 */
  vertexElevations?: number[];
  createdAt: number;
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
      color: string;
      area: number;
      perimeter: number;
      createdAt: number;
    };
  }[];
}
