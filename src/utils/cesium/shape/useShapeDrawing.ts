/* ==============================
 * 形状绘制 Composable（圆形 / 矩形）
 *
 * 两点击交互模式：
 *   圆形：第一击设置圆心 → 移动预览半径 → 第二击确认
 *   矩形：第一击设置角1 → 移动预览矩形 → 第二击确认
 *
 * 右键 / Escape 取消绘制
 * ============================== */

import { ref, toRaw } from 'vue';
import type { ComputedRef } from 'vue';
import {
  Cartesian3,
  Cartographic,
  Color,
  EllipsoidGeodesic,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from 'cesium';
import type { Viewer } from 'cesium';
import { isValidViewer, pickGlobe, toDeg, calcGeoRectangleSize } from '../shared/common';
import { useKeyboardShortcuts } from '../shared/useKeyboardShortcuts';
import type { ShortcutDef } from '../shared/useKeyboardShortcuts';

/** 形状类型 */
export type ShapeType = 'circle' | 'rectangle';

/** 圆形绘制结果 */
export interface CircleDrawResult {
  center: Cartesian3;
  radius: number;
}

/** 矩形绘制结果 */
export interface RectangleDrawResult {
  corner1: Cartesian3;
  corner2: Cartesian3;
  /** 四至坐标 [west, south, east, north]（度） */
  bounds: number[];
}

export interface LiveMeasureData {
  /** 圆形：半径（米）；矩形：宽度（米） */
  value1: number;
  /** 圆形：周长（米）；矩形：高度（米） */
  value2: number;
}

interface UseShapeDrawingOptions {
  viewer: ComputedRef<Viewer | null>;
  type: ShapeType;
  color?: string;
  onFinish?: (result: CircleDrawResult | RectangleDrawResult) => void;
  onCancel?: () => void;
  /** 实时测量回调（RAF 节流），value1/value2 含义因形状类型而异 */
  onLiveUpdate?: (data: LiveMeasureData | null) => void;
}

export function useShapeDrawing(options: UseShapeDrawingOptions) {
  const { viewer, type, color: colorStr, onFinish, onCancel, onLiveUpdate } = options;

  const isDrawing = ref(false);

  // 锚点位置
  let anchorPos: Cartesian3 | null = null;
  // 锚点标记实体（需单独清理）
  let anchorPointEntity: any = null;
  // 预览实体
  let previewEntity: any = null;
  // 预览线实体
  let previewLineEntity: any = null;
  // 鼠标事件处理
  let handler: ScreenSpaceEventHandler | null = null;
  // RAF 节流
  let rafId: number | null = null;
  let pendingMousePos: import('cesium').Cartesian2 | null = null;

  const color = Color.fromCssColorString(colorStr ?? '#1890FF');

  function getViewer(): Viewer | null {
    const v = toRaw(viewer.value);
    return isValidViewer(v) ? v : null;
  }

  /* ---- 键盘快捷键 ---- */
  const shortcuts: ShortcutDef[] = [
    { key: 'Escape', handler: () => cancelDraw() },
    {
      key: 'Enter',
      handler: () => {
        /* 第二击确认，由鼠标点击处理 */
      },
    },
  ];
  const kb = useKeyboardShortcuts(shortcuts);

  /* ---- 圆形：计算半径 ---- */
  function computeCircleRadius(center: Cartesian3, edge: Cartesian3): number {
    // 使用 WGS84 大地线距离
    const c = Cartographic.fromCartesian(center);
    const e = Cartographic.fromCartesian(edge);
    return new EllipsoidGeodesic(c, e).surfaceDistance;
  }

  /* ---- 矩形：计算四至 ---- */
  function computeRectangleBounds(corner1: Cartesian3, corner2: Cartesian3): number[] {
    const c1 = Cartographic.fromCartesian(corner1);
    const c2 = Cartographic.fromCartesian(corner2);
    const west = Math.min(toDeg(c1.longitude), toDeg(c2.longitude));
    const south = Math.min(toDeg(c1.latitude), toDeg(c2.latitude));
    const east = Math.max(toDeg(c1.longitude), toDeg(c2.longitude));
    const north = Math.max(toDeg(c1.latitude), toDeg(c2.latitude));
    return [west, south, east, north];
  }

  /* ---- 图形预览 ---- */
  function updateCirclePreview(center: Cartesian3, mousePos: Cartesian3): number {
    const v = getViewer();
    if (!v) return 0;
    const radius = computeCircleRadius(center, mousePos);

    if (!previewEntity) {
      previewEntity = v.entities.add({
        id: 'shape_draw_preview',
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          material: color.withAlpha(0.3),
          outline: true,
          outlineColor: color,
        },
        position: center,
      });
    } else {
      previewEntity.ellipse.semiMajorAxis = radius;
      previewEntity.ellipse.semiMinorAxis = radius;
    }

    // 预览线：圆心 → 鼠标
    if (!previewLineEntity) {
      previewLineEntity = v.entities.add({
        id: 'shape_draw_preview_line',
        polyline: {
          positions: [center, mousePos],
          width: 2,
          material: color.withAlpha(0.5),
          clampToGround: true,
        },
      });
    } else {
      previewLineEntity.polyline.positions = [center, mousePos];
    }
    return radius;
  }

  /* 根据对角两点计算矩形四个角点（经纬度交叉组合） */
  function computeRectangleCorners(corner1: Cartesian3, corner2: Cartesian3): Cartesian3[] {
    const c1 = Cartographic.fromCartesian(corner1);
    const c2 = Cartographic.fromCartesian(corner2);
    return [
      corner1,
      Cartesian3.fromDegrees(toDeg(c2.longitude), toDeg(c1.latitude), (c1.height + c2.height) / 2),
      corner2,
      Cartesian3.fromDegrees(toDeg(c1.longitude), toDeg(c2.latitude), (c1.height + c2.height) / 2),
    ];
  }

  function updateRectanglePreview(corner1: Cartesian3, mousePos: Cartesian3) {
    const v = getViewer();
    if (!v) return;
    const corners = computeRectangleCorners(corner1, mousePos);
    const closedPath = [...corners, corners[0]];

    if (!previewEntity) {
      previewEntity = v.entities.add({
        id: 'shape_draw_preview',
        polyline: {
          positions: closedPath,
          width: 2,
          material: color,
          clampToGround: true,
        },
      });
    } else {
      (previewEntity.polyline as any).positions = closedPath;
    }

    // 对角线指示：角点1 → 鼠标
    if (!previewLineEntity) {
      previewLineEntity = v.entities.add({
        id: 'shape_draw_preview_line',
        polyline: {
          positions: [corner1, mousePos],
          width: 1.5,
          material: color.withAlpha(0.35),
          clampToGround: true,
        },
      });
    } else {
      previewLineEntity.polyline.positions = [corner1, mousePos];
    }
  }

  /* ---- 生命周期 ---- */
  function startDraw() {
    const v = getViewer();
    if (!v || isDrawing.value) return;
    anchorPos = null;
    clearPreviews();
    isDrawing.value = true;
    v.canvas.style.cursor = 'crosshair';

    handler = new ScreenSpaceEventHandler(v.canvas);

    handler.setInputAction((movement: any) => {
      const v2 = getViewer();
      if (!v2) return;
      const cartesian = pickGlobe(v2, movement.position);
      if (!cartesian) return;

      if (!anchorPos) {
        anchorPos = Cartesian3.clone(cartesian);
        anchorPointEntity = v2.entities.add({
          id: 'shape_draw_anchor',
          position: anchorPos,
          point: {
            pixelSize: 8,
            color: Color.WHITE,
            outlineColor: color,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        return;
      }

      // 第二击：使用点击位置确认
      finishDraw(cartesian);
    }, ScreenSpaceEventType.LEFT_CLICK);

    // 鼠标移动预览（RAF 节流）
    handler.setInputAction((movement: any) => {
      if (!anchorPos) return;
      pendingMousePos = movement.endPosition;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const v2 = getViewer();
        if (!v2 || !pendingMousePos) return;
        const cartesian = pickGlobe(v2, pendingMousePos);
        if (!cartesian) return;
        if (type === 'circle') {
          const r = updateCirclePreview(anchorPos!, cartesian);
          onLiveUpdate?.({ value1: r, value2: 2 * Math.PI * r });
        } else {
          updateRectanglePreview(anchorPos!, cartesian);
          const bounds = computeRectangleBounds(anchorPos!, cartesian);
          const { width, height } = calcGeoRectangleSize({
            west: bounds[0],
            south: bounds[1],
            east: bounds[2],
            north: bounds[3],
          });
          onLiveUpdate?.({ value1: width, value2: height });
        }
        v2.canvas.style.cursor = 'crosshair';
        pendingMousePos = null;
      });
    }, ScreenSpaceEventType.MOUSE_MOVE);

    // 右键取消
    handler.setInputAction(() => {
      cancelDraw();
    }, ScreenSpaceEventType.RIGHT_CLICK);

    kb.setup();
  }

  function finishDraw(clickPos: Cartesian3) {
    if (!anchorPos || !onFinish) {
      cancelDraw();
      return;
    }

    if (type === 'circle') {
      const radius = computeCircleRadius(anchorPos, clickPos);
      if (radius < 1) {
        cancelDraw();
        return;
      }
      const center = anchorPos;
      cleanupDraw();
      onFinish({ center, radius });
    } else {
      const bounds = computeRectangleBounds(anchorPos, clickPos);
      const corner1 = anchorPos;
      const corner2 = clickPos;
      cleanupDraw();
      onFinish({ corner1, corner2, bounds });
    }
  }

  function cancelDraw() {
    cleanupDraw();
    onCancel?.();
  }

  function clearPreviews() {
    const v = getViewer();
    if (!v) return;
    if (previewEntity) {
      v.entities.remove(previewEntity);
      previewEntity = null;
    }
    if (previewLineEntity) {
      v.entities.remove(previewLineEntity);
      previewLineEntity = null;
    }
    if (anchorPointEntity) {
      v.entities.remove(anchorPointEntity);
      anchorPointEntity = null;
    }
  }

  function cleanupDraw() {
    isDrawing.value = false;
    anchorPos = null;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pendingMousePos = null;
    if (handler) {
      handler.destroy();
      handler = null;
    }
    clearPreviews();
    kb.teardown();
    const v = getViewer();
    if (v) v.canvas.style.cursor = 'default';
  }

  function destroy() {
    cleanupDraw();
  }

  return { isDrawing, startDraw, cancelDraw, destroy };
}
