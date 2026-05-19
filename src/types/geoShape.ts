/* ==============================
 * 圆形 / 矩形 类型定义
 *
 * 圆形使用 Cesium EllipseGraphics 渲染（半长轴 = 半短轴 = 半径）
 * 矩形使用 Cesium RectangleGraphics 渲染（通过四至坐标定义）
 * ============================== */

/** 圆形 */
export interface GeoCircle {
  id: string;
  name: string;
  /** 圆心 [lng, lat, height] */
  center: number[];
  /** 半径（米） */
  radius: number;
  color: string;
  visible: boolean;
  createdAt: string;
}

/** 矩形 */
export interface GeoRectangle {
  id: string;
  name: string;
  /** 西、南、东、北边界（度） */
  west: number;
  south: number;
  east: number;
  north: number;
  /** 高度（可选） */
  height?: number;
  color: string;
  visible: boolean;
  createdAt: string;
}

/** 面板活动工具类型 */
export type ActiveShapeTool = 'circle' | 'rectangle' | null;
