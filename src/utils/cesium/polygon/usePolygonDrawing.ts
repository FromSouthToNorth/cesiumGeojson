/* ==============================
 * Polygon Drawing Composable
 * 基于 useBaseDrawing 的多边形绘制包装器，保留面积/周长测量与实时预览
 *
 * 交互：
 *   左键单击添加顶点，鼠标移动预览下一段和闭合线
 *   右键 / Enter 完成，Backspace 撤销末点，Escape 取消
 * ============================== */

import type { ComputedRef, Ref } from 'vue';
import { Cartesian3, Cartographic, Ellipsoid, EllipsoidGeodesic } from 'cesium';
import type { Viewer } from 'cesium';
import { useBaseDrawing } from '../shared/useBaseDrawing';
import type { SnappingAPI } from '../shared/useBaseDrawing';
import type { GeoPolygonMeasureResult } from '@/types/geoPolygon';

/** 计算多边形周长和面积 */
export function calcPolygonMeasure(positions: Cartesian3[]): GeoPolygonMeasureResult {
  const n = positions.length;
  if (n < 3) return { segments: [], perimeter: 0, area: 0 };

  const cartos = new Array<Cartographic>(n);
  for (let i = 0; i < n; i++) {
    cartos[i] = Cartographic.fromCartesian(positions[i]);
  }

  const ellipsoid = Ellipsoid.WGS84;

  // 周长（geodesic 距离，包含闭合边）
  const segments: number[] = [];
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const geo = new EllipsoidGeodesic(cartos[i], cartos[j], ellipsoid);
    const d = geo.surfaceDistance;
    segments.push(d);
    perimeter += d;
  }

  // 面积（球面多边形公式，等积球近似 R = 6371000m）
  const R = 6371000;
  let areaSum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dLon = cartos[j].longitude - cartos[i].longitude;
    const avgLat = (cartos[i].latitude + cartos[j].latitude) / 2;
    areaSum += dLon * Math.sin(avgLat);
  }
  const area = (Math.abs(areaSum) * R * R) / 2;

  return { segments, perimeter, area };
}

export function usePolygonDrawing(options: {
  viewer: ComputedRef<Viewer | null>;
  positions: Ref<Cartesian3[]>;
  color?: string;
  /** 绘制完成回调（顶点 >= 3） */
  onFinish?: (result: GeoPolygonMeasureResult) => void;
  /** 绘制取消回调 */
  onCancel?: () => void;
  /** 实时更新回调（周长, 面积） */
  onLiveUpdate?: (perimeter: number, area: number) => void;
  /** 吸附功能 */
  snapping?: SnappingAPI;
}) {
  const { viewer, positions, color: colorStr = '#1890FF', onFinish, onCancel, onLiveUpdate, snapping } = options;

  /** 触发实时更新 */
  function handleLiveUpdate(pos: Cartesian3[], previewPos: Cartesian3 | null) {
    if (!onLiveUpdate) return;
    const n = pos.length;
    if (n < 2) {
      onLiveUpdate(0, 0);
      return;
    }

    const result = calcPolygonMeasure(pos);
    if (!previewPos || n < 1) {
      onLiveUpdate(result.perimeter, result.area);
      return;
    }

    // 包含预览段的估算周长和面积
    const previewDist = Cartesian3.distance(pos[n - 1], previewPos);
    const closeDist = Cartesian3.distance(previewPos, pos[0]);
    const previewPerimeter = result.perimeter - result.segments[result.segments.length - 1] + previewDist + closeDist;
    onLiveUpdate(previewPerimeter, result.area);
  }

  const base = useBaseDrawing({
    viewer,
    positions,
    minVertices: 3,
    color: colorStr,
    snapping,
    enablePreviewLine: true,
    enableClosurePreview: true,
    enableFill: true,
    closePolyline: true,
    onFinish: () => onFinish?.(calcPolygonMeasure(positions.value)),
    onCancel,
    onLiveUpdate: handleLiveUpdate,
  });

  return base;
}
