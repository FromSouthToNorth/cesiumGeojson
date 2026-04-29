/* ==============================
 * Polygon Drawing Composable
 * 绘制闭合多边形，支持面积和周长实时预览
 *
 * 交互：
 *   左键单击添加顶点，鼠标移动预览下一段和闭合线
 *   右键 / Enter 完成，Backspace 撤销末点，Escape 取消
 * ============================== */

import { ref, toRaw, triggerRef } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import {
  Cartesian3,
  Color,
  HeightReference,
  KeyboardEventModifier,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cartographic,
  Ellipsoid,
  EllipsoidGeodesic,
} from 'cesium';
import type { Viewer, Cartesian2 } from 'cesium';
import { isValidViewer, pickGlobe } from '../shared/common';
import { useKeyboardShortcuts } from '../shared/useKeyboardShortcuts';
import type { ShortcutDef } from '../shared/useKeyboardShortcuts';
import type { GeoPolygonMeasureResult } from '@/types/geoPolygon';
import type { SnapTarget } from '../shared/useSnapping';

export interface PolygonSnappingAPI {
  findSnapTarget: (
    screenPos: Cartesian2,
    worldPos: Cartesian3,
    exclude?: Cartesian3[],
    disableSnap?: boolean,
  ) => SnapTarget | null;
  setup: () => void;
  teardown: () => void;
  invalidateCache: () => void;
}

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
  positions: Ref<import('cesium').Cartesian3[]>;
  color?: string;
  /** 绘制完成回调（顶点 >= 3） */
  onFinish?: (result: GeoPolygonMeasureResult) => void;
  /** 绘制取消回调 */
  onCancel?: () => void;
  /** 实时更新回调（周长, 面积） */
  onLiveUpdate?: (perimeter: number, area: number) => void;
  /** 吸附功能 */
  snapping?: PolygonSnappingAPI;
}) {
  const { viewer, positions, color: colorStr = '#1890FF', onFinish, onCancel, onLiveUpdate } = options;
  const { snapping } = options;
  const isDrawing = ref(false);

  // Shift 键状态（临时禁用吸附）
  let shiftPressed = false;

  // Shift 键状态通过原生键盘事件跟踪（Cesium ScreenSpaceEventHandler 不提供 shiftKey）
  let onKeyDownShift: ((e: KeyboardEvent) => void) | null = null;
  let onKeyUpShift: ((e: KeyboardEvent) => void) | null = null;

  let handler: ScreenSpaceEventHandler | null = null;
  let previewPos: import('cesium').Cartesian3 | null = null;
  let _rafId: number | null = null;
  let _pendingMousePos: Cartesian2 | null = null;

  // 可视化 entity
  let polylineEntity: any = null;
  let pointEntities: any[] = [];
  let nextEdgeEntity: any = null;
  let closureEdgeEntity: any = null;
  let fillEntity: any = null;

  function getViewer(): Viewer | null {
    const v = toRaw(viewer.value);
    return isValidViewer(v) ? v : null;
  }

  /** 触发实时更新 */
  function emitLiveUpdate() {
    if (!onLiveUpdate) return;
    const pos = positions.value;
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

  /**
   * 吸附辅助函数：将地形坐标与吸附目标比较，返回吸附后坐标
   * @param disableSnap - 临时禁用（如 Shift 键按下）
   */
  function applySnapping(
    screenPos: import('cesium').Cartesian2,
    worldPos: import('cesium').Cartesian3,
    disableSnap = false,
  ): import('cesium').Cartesian3 {
    if (!snapping) return worldPos;
    const target = snapping.findSnapTarget(screenPos, worldPos, positions.value, disableSnap);
    return target ? target.position : worldPos;
  }

  /* ==============================
   *  键盘快捷键
   * ============================== */

  const shortcuts: ShortcutDef[] = [
    { key: 'Escape', handler: () => cancelDraw() },
    { key: 'Backspace', handler: () => undoLastVertex() },
    { key: 'Enter', handler: () => finishDraw() },
  ];
  const kb = useKeyboardShortcuts(shortcuts);

  /* ==============================
   *  绘制控制
   * ============================== */

  function startDraw() {
    const v = getViewer();
    if (!v || isDrawing.value) return;

    clearDrawGraphics();
    positions.value.length = 0;
    triggerRef(positions as any);
    previewPos = null;
    shiftPressed = false;
    isDrawing.value = true;
    v.canvas.style.cursor = 'crosshair';

    // 通过原生键盘事件跟踪 Shift 状态
    onKeyDownShift = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressed = true;
    };
    onKeyUpShift = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressed = false;
    };
    window.addEventListener('keydown', onKeyDownShift);
    window.addEventListener('keyup', onKeyUpShift);

    handler = new ScreenSpaceEventHandler(v.canvas);

    // 左键单击：添加顶点（无修饰键）
    handler.setInputAction((movement: any) => {
      const v2 = getViewer();
      if (!v2) return;
      const cartesian = pickGlobe(v2, movement.position);
      if (cartesian) {
        const finalPos = applySnapping(movement.position, cartesian, shiftPressed);
        positions.value.push(Cartesian3.clone(finalPos));
        triggerRef(positions as any);
        snapping?.invalidateCache();
        previewPos = null;
        drawHelper();
        emitLiveUpdate();
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    // Shift + 左键单击：同样需要添加顶点
    handler.setInputAction(
      (movement: any) => {
        const v2 = getViewer();
        if (!v2) return;
        const cartesian = pickGlobe(v2, movement.position);
        if (cartesian) {
          const finalPos = applySnapping(movement.position, cartesian, shiftPressed);
          positions.value.push(Cartesian3.clone(finalPos));
          triggerRef(positions as any);
          previewPos = null;
          drawHelper();
          emitLiveUpdate();
        }
      },
      ScreenSpaceEventType.LEFT_CLICK,
      KeyboardEventModifier.SHIFT,
    );

    // 鼠标移动：预览（使用 requestAnimationFrame 节流，避免高刷新率下的冗余计算）
    handler.setInputAction((movement: any) => {
      if (positions.value.length === 0) return;
      _pendingMousePos = movement.endPosition;
      if (_rafId !== null) return; // 已排入队列，等待执行
      _rafId = requestAnimationFrame(() => {
        _rafId = null;
        const v2 = getViewer();
        if (!v2 || !_pendingMousePos) return;
        const cartesian = pickGlobe(v2, _pendingMousePos);
        if (cartesian) {
          const finalPos = applySnapping(_pendingMousePos, cartesian, shiftPressed);
          previewPos = finalPos;
          updatePreview(finalPos);
          emitLiveUpdate();
          v2.canvas.style.cursor = !shiftPressed && finalPos !== cartesian ? 'copy' : 'crosshair';
        }
        _pendingMousePos = null;
      });
    }, ScreenSpaceEventType.MOUSE_MOVE);

    // 右键：完成绘制
    handler.setInputAction(() => {
      finishDraw();
    }, ScreenSpaceEventType.RIGHT_CLICK);

    // 左键双击：完成绘制（无修饰键）
    handler.setInputAction((movement: any) => {
      if (positions.value.length < 3) return;
      const v2 = getViewer();
      if (!v2) return;
      const cartesian = pickGlobe(v2, movement.position);
      if (cartesian) {
        const finalPos = applySnapping(movement.position, cartesian, shiftPressed);
        const last = positions.value[positions.value.length - 1];
        if (Cartesian3.distance(finalPos, last) < 5) {
          finishDraw();
        }
      }
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // Shift + 左键双击：同样需要完成绘制
    handler.setInputAction(
      (movement: any) => {
        if (positions.value.length < 3) return;
        const v2 = getViewer();
        if (!v2) return;
        const cartesian = pickGlobe(v2, movement.position);
        if (cartesian) {
          const finalPos = applySnapping(movement.position, cartesian, shiftPressed);
          const last = positions.value[positions.value.length - 1];
          if (Cartesian3.distance(finalPos, last) < 5) {
            finishDraw();
          }
        }
      },
      ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
      KeyboardEventModifier.SHIFT,
    );

    kb.setup();
    snapping?.setup();
  }

  /** 完成绘制 */
  function finishDraw() {
    cleanupDraw();
    previewPos = null;

    if (positions.value.length < 3) {
      onCancel?.();
      return;
    }
    const result = calcPolygonMeasure(positions.value);
    onFinish?.(result);
  }

  /** 取消绘制 */
  function cancelDraw() {
    cleanupDraw();
    previewPos = null;
    onCancel?.();
  }

  /** 撤销最后一个顶点 */
  function undoLastVertex() {
    if (positions.value.length === 0) return;
    positions.value.pop();
    triggerRef(positions as any);
    snapping?.invalidateCache();
    previewPos = null;
    drawHelper();
    emitLiveUpdate();
  }

  /* ==============================
   *  可视化
   * ============================== */

  /** 重建路径、顶点和填充图形 */
  function drawHelper() {
    const v = getViewer();
    if (!v) return;

    // 清理旧图形
    if (polylineEntity) {
      v.entities.remove(polylineEntity);
      polylineEntity = null;
    }
    if (fillEntity) {
      v.entities.remove(fillEntity);
      fillEntity = null;
    }
    pointEntities.forEach((e) => v.entities.remove(e));
    pointEntities = [];

    const pos = positions.value;
    const color = Color.fromCssColorString(colorStr);
    const n = pos.length;

    // 填充面（>= 3 个顶点）
    if (n >= 3) {
      fillEntity = v.entities.add({
        polygon: {
          hierarchy: [...pos],
          material: color.withAlpha(0.15),
          outline: false,
        },
      });
    }

    // 路径线（>= 2 个顶点）
    if (n >= 2) {
      polylineEntity = v.entities.add({
        polyline: {
          positions: [...pos, pos[0]],
          width: 3,
          material: color,
          clampToGround: true,
        },
      });
    }

    // 顶点标记
    pos.forEach((p) => {
      pointEntities.push(
        v.entities.add({
          position: p,
          point: {
            pixelSize: 8,
            color: Color.WHITE,
            outlineColor: color,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        }),
      );
    });
  }

  /** 更新预览线段和闭合预览 */
  function updatePreview(mousePos: import('cesium').Cartesian3) {
    const v = getViewer();
    if (!v) return;

    const n = positions.value.length;
    const last = positions.value[n - 1];
    const first = positions.value[0];
    if (!last) return;

    const previewColor = Color.fromCssColorString(colorStr).withAlpha(0.4);

    // 下一条边（末点 → 鼠标）
    if (nextEdgeEntity) {
      nextEdgeEntity.polyline.positions = [last, mousePos];
    } else {
      nextEdgeEntity = v.entities.add({
        polyline: {
          positions: [last, mousePos],
          width: 2,
          material: previewColor,
          clampToGround: true,
        },
      });
    }

    // 闭合边（鼠标 → 首点）
    if (n >= 1) {
      if (closureEdgeEntity) {
        closureEdgeEntity.polyline.positions = [mousePos, first];
      } else {
        closureEdgeEntity = v.entities.add({
          polyline: {
            positions: [mousePos, first],
            width: 2,
            material: previewColor,
            clampToGround: true,
          },
        });
      }
    }
  }

  /** 清除所有绘制图形 */
  function clearDrawGraphics() {
    const v = getViewer();
    if (!v) return;

    if (polylineEntity) {
      v.entities.remove(polylineEntity);
      polylineEntity = null;
    }
    if (nextEdgeEntity) {
      v.entities.remove(nextEdgeEntity);
      nextEdgeEntity = null;
    }
    if (closureEdgeEntity) {
      v.entities.remove(closureEdgeEntity);
      closureEdgeEntity = null;
    }
    if (fillEntity) {
      v.entities.remove(fillEntity);
      fillEntity = null;
    }
    pointEntities.forEach((e) => v.entities.remove(e));
    pointEntities = [];
  }

  /** 清理绘制资源 */
  function cleanupDraw() {
    isDrawing.value = false;
    shiftPressed = false;
    if (_rafId !== null) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    _pendingMousePos = null;
    if (handler) {
      handler.destroy();
      handler = null;
    }
    if (onKeyDownShift) {
      window.removeEventListener('keydown', onKeyDownShift);
      onKeyDownShift = null;
    }
    if (onKeyUpShift) {
      window.removeEventListener('keyup', onKeyUpShift);
      onKeyUpShift = null;
    }
    clearDrawGraphics();
    kb.teardown();
    snapping?.teardown();
    const v = getViewer();
    if (v) v.canvas.style.cursor = 'default';
  }

  /* ==============================
   *  生命周期
   * ============================== */

  function destroy() {
    cleanupDraw();
    previewPos = null;
  }

  return {
    isDrawing,
    startDraw,
    cancelDraw,
    undoLastVertex,
    destroy,
  };
}
