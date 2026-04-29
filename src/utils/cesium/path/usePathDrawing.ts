/* ==============================
 * Path Drawing Composable
 * 绘制折线路径，支持实时距离预览
 *
 * 交互：
 *   左键单击添加顶点，鼠标移动预览下一段
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
} from 'cesium';
import type { Viewer } from 'cesium';
import { isValidViewer, pickGlobe } from '../shared/common';
import { useKeyboardShortcuts } from '../shared/useKeyboardShortcuts';
import type { ShortcutDef } from '../shared/useKeyboardShortcuts';
import { calcPathDistances } from './usePathMeasure';
import type { PathMeasureResult } from './usePathMeasure';
import type { SnapTarget } from '../shared/useSnapping';

export interface SnappingAPI {
  findSnapTarget: (
    screenPos: import('cesium').Cartesian2,
    worldPos: import('cesium').Cartesian3,
    exclude?: import('cesium').Cartesian3[],
    disableSnap?: boolean,
  ) => SnapTarget | null;
  setup: () => void;
  teardown: () => void;
  invalidateCache: () => void;
}

export function usePathDrawing(options: {
  viewer: ComputedRef<Viewer | null>;
  positions: Ref<Cartesian3[]>;
  /** 绘制预览线颜色 getter，每次绘制时调用 */
  color?: () => string;
  /** 绘制完成回调（顶点 >= 2） */
  onFinish?: (result: PathMeasureResult) => void;
  /** 绘制取消回调 */
  onCancel?: () => void;
  /** 距离更新回调（用于面板实时显示） */
  onLiveUpdate?: (segments: number[], total: number) => void;
  /** 吸附功能 */
  snapping?: SnappingAPI;
}) {
  const { viewer, positions, color: colorGetter, onFinish, onCancel, onLiveUpdate } = options;
  const { snapping } = options;
  const getColor = colorGetter ?? (() => '#1890FF');
  const isDrawing = ref(false);

  // Shift 键状态（临时禁用吸附）
  let shiftPressed = false;

  // 鼠标交互
  let handler: ScreenSpaceEventHandler | null = null;
  // 预览鼠标位置（用于实时距离计算）
  let previewPos: Cartesian3 | null = null;

  // 可视化 entity
  let polylineEntity: any = null;
  let pointEntities: any[] = [];
  let previewLineEntity: any = null;
  let _rafId: number | null = null;
  let _pendingMousePos: import('cesium').Cartesian2 | null = null;

  /** 获取 viewer 实例，已判空和销毁检查 */
  function getViewer(): Viewer | null {
    const v = toRaw(viewer.value);
    return isValidViewer(v) ? v : null;
  }

  /** 触发实时距离更新 */
  function emitLiveUpdate() {
    if (!onLiveUpdate) return;
    const pos = positions.value;
    const n = pos.length;
    if (n < 2) {
      onLiveUpdate([], 0);
      return;
    }

    const result = calcPathDistances(pos);
    if (!previewPos || n < 1) {
      onLiveUpdate(result.segments, result.total);
      return;
    }

    // 包含预览段的距离
    const previewDist = Cartesian3.distance(pos[n - 1], previewPos);
    onLiveUpdate([...result.segments, previewDist], result.total + previewDist);
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

  // Shift 键状态通过原生键盘事件跟踪（Cesium ScreenSpaceEventHandler 不提供 shiftKey）
  let onKeyDownShift: ((e: KeyboardEvent) => void) | null = null;
  let onKeyUpShift: ((e: KeyboardEvent) => void) | null = null;

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

    // 鼠标移动：预览下一段（使用 requestAnimationFrame 节流）
    handler.setInputAction((movement: any) => {
      if (positions.value.length === 0) return;
      _pendingMousePos = movement.endPosition;
      if (_rafId !== null) return;
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
      if (positions.value.length < 2) return;
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
        if (positions.value.length < 2) return;
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

    if (positions.value.length < 2) {
      onCancel?.();
      return;
    }
    const result = calcPathDistances(positions.value);
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

  /** 重建路径和顶点图形 */
  function drawHelper() {
    const v = getViewer();
    if (!v) return;

    // 清理旧图形
    if (polylineEntity) {
      v.entities.remove(polylineEntity);
      polylineEntity = null;
    }
    pointEntities.forEach((e) => v.entities.remove(e));
    pointEntities = [];

    const pos = positions.value;
    const color = Color.fromCssColorString(getColor());

    // 路径线（>= 2 个顶点才画线，否则只画点）
    if (pos.length >= 2) {
      polylineEntity = v.entities.add({
        polyline: {
          positions: [...pos],
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

  /** 更新预览线段 */
  function updatePreview(mousePos: Cartesian3) {
    const v = getViewer();
    if (!v) return;

    const last = positions.value[positions.value.length - 1];
    if (!last) return;

    if (previewLineEntity) {
      previewLineEntity.polyline.positions = [last, mousePos];
    } else {
      const color = Color.fromCssColorString(getColor()).withAlpha(0.4);
      previewLineEntity = v.entities.add({
        polyline: {
          positions: [last, mousePos],
          width: 3,
          material: color,
          clampToGround: true,
        },
      });
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
    if (previewLineEntity) {
      v.entities.remove(previewLineEntity);
      previewLineEntity = null;
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
