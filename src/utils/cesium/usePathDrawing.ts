/* ==============================
 * Path Drawing Composable
 * 绘制折线路径，支持实时距离预览
 *
 * 交互：
 *   左键单击添加顶点，鼠标移动预览下一段
 *   右键 / Enter 完成，Backspace 撤销末点，Escape 取消
 * ============================== */

import { ref, toRaw } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import {
  Cartesian3,
  Color,
  HeightReference,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from 'cesium';
import type { Viewer } from 'cesium';
import { isValidViewer, pickGlobe } from './clipCommon';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import type { ShortcutDef } from './useKeyboardShortcuts';
import { calcPathDistances } from './usePathMeasure';
import type { PathMeasureResult } from './usePathMeasure';

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
}) {
  const { viewer, positions, color: colorGetter, onFinish, onCancel, onLiveUpdate } = options;
  const getColor = colorGetter ?? (() => '#1890FF');
  const isDrawing = ref(false);

  // 鼠标交互
  let handler: ScreenSpaceEventHandler | null = null;
  // 预览鼠标位置（用于实时距离计算）
  let previewPos: Cartesian3 | null = null;

  // 可视化 entity
  let polylineEntity: any = null;
  let pointEntities: any[] = [];
  let previewLineEntity: any = null;

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
    previewPos = null;
    isDrawing.value = true;

    handler = new ScreenSpaceEventHandler(v.canvas);

    // 左键单击：添加顶点
    handler.setInputAction((movement: any) => {
      const v2 = getViewer();
      if (!v2) return;
      const cartesian = pickGlobe(v2, movement.position);
      if (cartesian) {
        positions.value.push(Cartesian3.clone(cartesian));
        previewPos = null;
        drawHelper();
        emitLiveUpdate();
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    // 鼠标移动：预览下一段
    handler.setInputAction((movement: any) => {
      if (positions.value.length === 0) return;
      const v2 = getViewer();
      if (!v2) return;
      const cartesian = pickGlobe(v2, movement.endPosition);
      if (cartesian) {
        previewPos = cartesian;
        updatePreview(cartesian);
        emitLiveUpdate();
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    // 右键：完成绘制
    handler.setInputAction(() => {
      finishDraw();
    }, ScreenSpaceEventType.RIGHT_CLICK);

    // 左键双击：完成绘制
    handler.setInputAction((movement: any) => {
      if (positions.value.length < 2) return;
      const v2 = getViewer();
      if (!v2) return;
      const cartesian = pickGlobe(v2, movement.position);
      if (cartesian) {
        const last = positions.value[positions.value.length - 1];
        if (Cartesian3.distance(cartesian, last) < 5) {
          finishDraw();
        }
      }
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    kb.setup();
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
    if (handler) {
      handler.destroy();
      handler = null;
    }
    clearDrawGraphics();
    kb.teardown();
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
