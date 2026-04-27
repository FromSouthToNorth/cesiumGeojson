/* ==============================
 * usePolygonSlope —— 多边形空间坡度分析
 * 在 polygon 范围内生成网格采样点，逐点计算坡度并汇总统计
 * ============================== */

import { Cartographic, Ellipsoid, sampleTerrain } from 'cesium';
import type { TerrainProvider } from 'cesium';
import type { SlopeAnalysisResult, SlopeGridPoint } from '@/types/geoPolygon';

/** 射线法判断点是否在多边形内 */
function pointInPolygon(lon: number, lat: number, verts: { lon: number; lat: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const pi = verts[i],
      pj = verts[j];
    if (pi.lat > lat !== pj.lat > lat && lon < ((pj.lon - pi.lon) * (lat - pi.lat)) / (pj.lat - pi.lat) + pi.lon) {
      inside = !inside;
    }
  }
  return inside;
}

/** 计算经纬度多边形球面面积 (m²) */
function sphericalArea(positions: Cartographic[]): number {
  if (positions.length < 3) return 0;
  const R = Ellipsoid.WGS84.maximumRadius;
  const n = positions.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum +=
      (positions[j].longitude - positions[i].longitude) *
      (2 + Math.sin(positions[i].latitude) + Math.sin(positions[j].latitude));
  }
  return Math.abs((sum * R * R) / 2);
}

export interface SlopeAnalysisOptions {
  /** 最大采样点数（默认 20000） */
  maxPoints?: number;
  /** 地形采样级别（默认 13） */
  terrainLevel?: number;
}

/**
 * 对多边形区域进行空间坡度分析
 *
 * 算法：
 *   1. 根据多边形面积动态计算网格间距
 *   2. 在包围盒内生成规则网格，筛选多边形内部的点
 *   3. 批量采样地形高程
 *   4. 对每个有效点，搜索邻域内相邻点，用最小二乘拟合平面计算坡度
 */
export async function analyzePolygonSlope(
  terrainProvider: TerrainProvider,
  positions: Cartographic[],
  options: SlopeAnalysisOptions = {},
): Promise<SlopeAnalysisResult | null> {
  if (positions.length < 3) return null;

  const { maxPoints = 20000, terrainLevel = 13 } = options;

  // 面积安全校验
  const polyArea = sphericalArea(positions);
  const MIN_AREA = 100; // 100 m²
  const MAX_AREA = 10_000_000_000; // 10000 m²
  if (polyArea < MIN_AREA) {
    throw new Error(`AREA_TOO_SMALL:多边形面积过小（${polyArea.toFixed(0)} m²），至少需要 ${MIN_AREA} m²`);
  }
  if (polyArea > MAX_AREA) {
    throw new Error(
      `AREA_TOO_LARGE:多边形面积 ${(polyArea / 1_000_000).toFixed(1)} km² 超出建议范围（≤${MAX_AREA / 1_000_000} km²），` +
        '过大的区域可能导致浏览器卡顿或分析失败，建议拆分为更小的区域',
    );
  }

  // 1. 包围盒
  let minLon = Infinity,
    maxLon = -Infinity;
  let minLat = Infinity,
    maxLat = -Infinity;
  for (const p of positions) {
    if (p.longitude < minLon) minLon = p.longitude;
    if (p.longitude > maxLon) maxLon = p.longitude;
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
  }
  const lonRange = maxLon - minLon;
  const latRange = maxLat - minLat;
  if (lonRange === 0 || latRange === 0) return null;

  // 2. 经纬度 → 米（Cartographic 使用弧度，需转角度）
  const radToDeg = 180 / Math.PI;
  const midLat = (minLat + maxLat) / 2;
  const mPerDegLon = 111320 * Math.cos(midLat);
  const mPerDegLat = 111320;
  const widthM = lonRange * radToDeg * mPerDegLon;
  const heightM = latRange * radToDeg * mPerDegLat;

  const bboxArea = widthM * heightM;
  const fillRatio = bboxArea > 0 ? Math.min(1, polyArea / bboxArea) : 0.5;

  // 3. 动态网格间距：目标点数为 maxPoints
  const area_ = bboxArea * fillRatio;
  let gridSpacing = Math.sqrt(area_ / maxPoints);
  gridSpacing = Math.max(2, Math.round(gridSpacing));

  // 确保至少 2x2 网格，同时限制网格尺寸防止采样点过多
  const cols = Math.max(2, Math.round(widthM / gridSpacing));
  const rows = Math.max(2, Math.round(heightM / gridSpacing));
  if (cols > 300 || rows > 300) {
    // 防止网格过密，重新计算
    gridSpacing = Math.max(Math.ceil(widthM / 300), Math.ceil(heightM / 300), 3);
  }

  const finalCols = Math.max(2, Math.round(widthM / gridSpacing));
  const finalRows = Math.max(2, Math.round(heightM / gridSpacing));

  // 4. 生成多边形内部网格点
  const verts = positions.map((p) => ({ lon: p.longitude, lat: p.latitude }));
  const sampleCartos: Cartographic[] = [];

  for (let r = 0; r <= finalRows; r++) {
    const lat = minLat + (latRange * r) / finalRows;
    for (let c = 0; c <= finalCols; c++) {
      const lon = minLon + (lonRange * c) / finalCols;
      if (pointInPolygon(lon, lat, verts)) {
        sampleCartos.push(new Cartographic(lon, lat, 0));
      }
    }
  }

  if (sampleCartos.length < 3) return null;

  // 5. 采样地形
  const sampled = await sampleTerrain(terrainProvider, terrainLevel, sampleCartos);

  // 6. 提取有效点，同时构建 2D 网格方便邻域查找
  const R = finalRows + 1;
  const C = finalCols + 1;
  const grid: (number | null)[][] = Array.from({ length: R }, () => Array(C).fill(null));
  const validPoints: { lon: number; lat: number; elev: number; ri: number; ci: number }[] = [];
  let idx = 0;
  for (let r = 0; r <= finalRows; r++) {
    const lat = minLat + (latRange * r) / finalRows;
    for (let c = 0; c <= finalCols; c++) {
      if (idx >= sampleCartos.length) break;
      const isInside = pointInPolygon(minLon + (lonRange * c) / finalCols, lat, verts);
      if (!isInside) continue;
      const h = sampled[idx]?.height;
      if (h != null && isFinite(h)) {
        grid[r][c] = h;
        validPoints.push({ lon: minLon + (lonRange * c) / finalCols, lat, elev: h, ri: r, ci: c });
      }
      idx++;
    }
  }

  if (validPoints.length < 3) return null;

  // 7. 用 Horn 算法计算每个网格点的坡度（百分比 + 角度）
  const slopeGrid: (number | null)[][] = Array.from({ length: R }, () => Array(C).fill(null));
  const allSlopes: number[] = [];
  const allAngles: number[] = [];

  for (let r = 1; r < R - 1; r++) {
    for (let c = 1; c < C - 1; c++) {
      const z = grid[r][c];
      if (z == null) continue;

      // 需要 3x3 窗口全部有效
      const zNW = grid[r - 1][c - 1],
        zN = grid[r - 1][c],
        zNE = grid[r - 1][c + 1];
      const zW = grid[r][c - 1],
        zE = grid[r][c + 1];
      const zSW = grid[r + 1][c - 1],
        zS = grid[r + 1][c],
        zSE = grid[r + 1][c + 1];
      if (
        zNW == null ||
        zN == null ||
        zNE == null ||
        zW == null ||
        zE == null ||
        zSW == null ||
        zS == null ||
        zSE == null
      )
        continue;

      // Horn 算法
      const dx = (zNE + 2 * zE + zSE - (zNW + 2 * zW + zSW)) / (8 * gridSpacing);
      const dy = (zSW + 2 * zS + zSE - (zNW + 2 * zN + zNE)) / (8 * gridSpacing);
      const slopeVal = Math.sqrt(dx * dx + dy * dy);
      const slopePercent = slopeVal * 100;
      const slopeAngle = Math.atan(slopeVal) * (180 / Math.PI); // 转为角度 °

      if (isFinite(slopePercent) && slopePercent >= 0) {
        slopeGrid[r][c] = slopePercent;
        allSlopes.push(slopePercent);
        allAngles.push(slopeAngle);
      }
    }
  }

  if (allSlopes.length < 3) return null;

  // 8. 汇总统计（百分比 + 角度）
  allSlopes.sort((a, b) => a - b);
  const minSlope = allSlopes[0];
  const maxSlope = allSlopes[allSlopes.length - 1];
  const avgSlope = allSlopes.reduce((s, v) => s + v, 0) / allSlopes.length;
  const medianSlope =
    allSlopes.length % 2 === 0
      ? (allSlopes[allSlopes.length / 2 - 1] + allSlopes[allSlopes.length / 2]) / 2
      : allSlopes[Math.floor(allSlopes.length / 2)];
  const variance = allSlopes.reduce((s, v) => s + (v - avgSlope) ** 2, 0) / allSlopes.length;
  const stdDevSlope = Math.sqrt(variance);

  allAngles.sort((a, b) => a - b);
  const minAngle = allAngles[0];
  const maxAngle = allAngles[allAngles.length - 1];
  const avgAngle = allAngles.reduce((s, v) => s + v, 0) / allAngles.length;

  // 坡度分类：基于角度阈值（5° 以下平缓，5-15° 中等，15° 以上陡峭）
  let gentle = 0,
    moderate = 0,
    steep = 0;
  for (const a of allAngles) {
    if (a < 5) gentle++;
    else if (a < 15) moderate++;
    else steep++;
  }
  const total = gentle + moderate + steep || 1;

  // 9. 收集每个网格点的位置 + 坡度/角度 + 分类
  const gridPoints: SlopeGridPoint[] = [];
  for (let r = 1; r < R - 1; r++) {
    for (let c = 1; c < C - 1; c++) {
      const s = slopeGrid[r][c];
      if (s == null) continue;
      const lon = minLon + (lonRange * c) / finalCols;
      const lat = minLat + (latRange * r) / finalRows;
      const h = grid[r][c] ?? 0; // 网格中心点的高程
      const a = Math.atan(s / 100) * (180 / Math.PI); // 从百分比反算角度
      const category: 'gentle' | 'moderate' | 'steep' = a < 5 ? 'gentle' : a < 15 ? 'moderate' : 'steep';
      gridPoints.push({ lon, lat, height: h, slope: s, angle: a, category });
    }
  }

  const elevations = validPoints.map((p) => p.elev);
  elevations.sort((a, b) => a - b);
  const minElev = elevations[0];
  const maxElev = elevations[elevations.length - 1];
  const avgElev = elevations.reduce((s, v) => s + v, 0) / elevations.length;

  return {
    minSlope,
    maxSlope,
    avgSlope,
    medianSlope,
    minAngle,
    maxAngle,
    avgAngle,
    stdDevSlope,
    gentlePct: (gentle / total) * 100,
    moderatePct: (moderate / total) * 100,
    steepPct: (steep / total) * 100,
    minElevation: minElev,
    maxElevation: maxElev,
    avgElevation: avgElev,
    elevationRange: maxElev - minElev,
    sampleCount: validPoints.length,
    gridSpacing,
    gridPoints,
  };
}
