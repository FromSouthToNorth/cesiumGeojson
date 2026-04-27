/* ==============================
 * Path Profile — 高程剖面采样计算
 * 沿路径等间距采样地形高程，计算剖面统计数据
 * ============================== */

import { Cartographic, Ellipsoid, EllipsoidGeodesic, sampleTerrain } from 'cesium';
import type { TerrainProvider } from 'cesium';
import type { ElevationProfile } from '@/types/geoPath';

export interface ProfileOptions {
  /** 采样间距（米），默认 10 */
  interval?: number;
  /** 地形采样精度级别，默认 11 */
  terrainLevel?: number;
}

/**
 * 沿路径采样地形高程并生成剖面数据
 *
 * 算法：
 *   1. 沿 geodesic 路径按 interval 等距插值出采样点
 *   2. 合并原始顶点 + 插值点，调用 sampleTerrain 批量采样
 *   3. 计算 min/max/avg、累计爬升/下降、平均坡度
 */
export async function samplePathProfile(
  terrainProvider: TerrainProvider,
  positions: import('cesium').Cartesian3[],
  options: ProfileOptions = {},
): Promise<ElevationProfile | null> {
  if (positions.length < 2) return null;

  const { interval = 5, terrainLevel = 13 } = options;
  const ellipsoid = Ellipsoid.WGS84;

  // 1. 转换所有顶点为 Cartographic
  const n = positions.length;
  const cartos = new Array<Cartographic>(n);
  for (let i = 0; i < n; i++) {
    cartos[i] = Cartographic.fromCartesian(positions[i]);
  }

  // 2. 计算每段距离和累计距离
  const segDists: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const geodesic = new EllipsoidGeodesic(cartos[i], cartos[i + 1], ellipsoid);
    const d = geodesic.surfaceDistance;
    segDists.push(d);
  }

  // 3. 沿路径等距插值出采样点
  const sampleCartos: Cartographic[] = [];

  for (let i = 0; i < n - 1; i++) {
    const segDist = segDists[i];
    const start = cartos[i];
    const end = cartos[i + 1];

    // 此段内需要的插值点数（不含起点）
    const steps = Math.max(1, Math.floor(segDist / interval));
    const dLon = (end.longitude - start.longitude) / steps;
    const dLat = (end.latitude - start.latitude) / steps;

    for (let j = 0; j < steps; j++) {
      sampleCartos.push(
        new Cartographic(start.longitude + dLon * j, start.latitude + dLat * j, 0),
      );
    }
  }
  // 确保终点被包含
  sampleCartos.push(cartos[n - 1]);

  // 4. 批量采样地形高程
  const sampled = await sampleTerrain(terrainProvider, terrainLevel, sampleCartos);
  const validElevations = sampled
    .map((c) => c.height)
    .filter((h): h is number => h != null && isFinite(h));

  if (validElevations.length < 2) {
    // 采样失败，返回基础数据
    return null;
  }

  // 5. 计算采样点对应的累计距离
  const totalDist = segDists.reduce((a, b) => a + b, 0);
  const sampleDistances: number[] = [];
  let dAccum = 0;
  for (let i = 0; i < n - 1; i++) {
    const steps = Math.max(1, Math.floor(segDists[i] / interval));
    const stepDist = segDists[i] / steps;
    for (let j = 0; j < steps; j++) {
      sampleDistances.push(dAccum + stepDist * j);
    }
    dAccum += segDists[i];
  }
  sampleDistances.push(totalDist);

  // 确保采样点数量和距离数组长度一致
  const count = Math.min(sampleDistances.length, validElevations.length);

  // 6. 统计
  const elevations = validElevations.slice(0, count);
  const distances = sampleDistances.slice(0, count);

  let minElevation = Infinity;
  let maxElevation = -Infinity;
  let sumElevation = 0;
  let totalClimb = 0;
  let totalDescent = 0;

  for (let i = 0; i < count; i++) {
    const h = elevations[i];
    if (h < minElevation) minElevation = h;
    if (h > maxElevation) maxElevation = h;
    sumElevation += h;
    if (i > 0) {
      const diff = h - elevations[i - 1];
      if (diff > 0) totalClimb += diff;
      else totalDescent += Math.abs(diff);
    }
  }

  const avgElevation = sumElevation / count;
  const avgGradient = totalDist > 0 ? ((totalClimb + totalDescent) / totalDist) * 100 : 0;

  return {
    distances,
    elevations,
    minElevation,
    maxElevation,
    avgElevation,
    totalClimb,
    totalDescent,
    avgGradient,
  };
}
