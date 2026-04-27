/* ==============================
 * Path Measure — 路径距离计算
 * 将 Cartesian3 顶点数组转换为椭球面 geodesic 距离
 * ============================== */

import { Cartographic, Ellipsoid, EllipsoidGeodesic } from 'cesium';

export interface PathMeasureResult {
  /** 每段距离（米），segments[i] 为 positions[i] → positions[i+1] 的弧距 */
  segments: number[];
  /** 总距离（米） */
  total: number;
}

/**
 * 计算路径分段距离和总距离
 * 使用 WGS84 椭球体的 geodesicDistanceBetween 获取精确椭球面弧距，
 * 比 Cartesian3.distance（直线穿透地球内部）更接近地表真实距离。
 */
export function calcPathDistances(positions: import('cesium').Cartesian3[]): PathMeasureResult {
  const n = positions.length;
  const segments: number[] = [];
  let total = 0;

  if (n < 2) return { segments, total };

  const ellipsoid = Ellipsoid.WGS84;
  const cartos = new Array<Cartographic>(n);
  for (let i = 0; i < n; i++) {
    cartos[i] = Cartographic.fromCartesian(positions[i]);
  }

  for (let i = 0; i < n - 1; i++) {
    const geodesic = new EllipsoidGeodesic(cartos[i], cartos[i + 1], ellipsoid);
    const dist = geodesic.surfaceDistance;
    segments.push(dist);
    total += dist;
  }

  return { segments, total };
}
