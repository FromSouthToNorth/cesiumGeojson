/* ==============================
 * Base Drawing Composable
 * 通用地图绘制基础能力封装
 *
 * 职责：
 *   管理绘制生命周期（开始/完成/取消/撤销）
 *   注册鼠标/键盘事件（左键加点、右键结束、双击收尾、Esc/Enter/Backspace）
 *   集成吸附功能（Shift 临时禁用）
 *   管理通用绘制实体（顶点标记、折线、预览线、闭合预览线、填充面）
 *   RAF 节流鼠标移动预览
 *
 * 使用方式：
 *   由 usePathDrawing / usePolygonDrawing 等包装器实例化，传入差异化配置
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
import { isValidViewer, pickGlobe } from './common';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import type { ShortcutDef } from './useKeyboardShortcuts';
import type { SnapTarget } from './useSnapping';

/* ==============================
 *  类型定义
 * ============================== */

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

export interface UseBaseDrawingOptions {
  viewer: ComputedRef<Viewer | null>;
  positions: Ref<Cartesian3[]>;
  /** 完成绘制所需的最少顶点数 */
  minVertices: number;
  /** 颜色，支持静态字符串或动态 getter */
  color: string | (() => string);
  /** 吸附功能（可选） */
  snapping?: SnappingAPI;

  // --- 可视化开关 ---
  /** 是否显示末点到鼠标的预览线 */
  enablePreviewLine?: boolean;
  /** 是否显示鼠标到首点的闭合预览线 */
  enableClosurePreview?: boolean;
  /** 是否显示半透明填充面（>= minVertices 时） */
  enableFill?: boolean;
  /** 折线是否首尾闭合 */
  closePolyline?: boolean;

  // --- 回调 ---
  onFinish?: () => void;
  onCancel?: () => void;
  /** 状态变化时触发（加点、撤销、鼠标移动后），由包装器计算具体测量值 */
  onLiveUpdate?: (positions: Cartesian3[], previewPos: Cartesian3 | null) => void;
}

export interface UseBaseDrawingReturn {
  isDrawing: Ref<boolean>;
  startDraw: () => void;
  cancelDraw: () => void;
  undoLastVertex: () => void;
  destroy: () => void;
}

/* ==============================
 *  Core
 * ============================== */

export function useBaseDrawing(options: UseBaseDrawingOptions): UseBaseDrawingReturn {
  const {
    viewer,
    positions,
    minVertices,
    color: colorOpt,
    snapping,
    enablePreviewLine = false,
    enableClosurePreview = false,
    enableFill = false,
    closePolyline = false,
    onFinish,
    onCancel,
    onLiveUpdate,
  } = options;

  const isDrawing = ref(false);

  // Shift 键状态（临时禁用吸附）
  let shiftPressed = false;

  // 鼠标交互
  let handler: ScreenSpaceEventHandler | null = null;
  // 预览鼠标位置
  let previewPos: Cartesian3 | null = null;

  // RAF 节流
  let _rafId: number | null = null;
  let _pendingMousePos: import('cesium').Cartesian2 | null = null;

  // 可视化 entity
  let polylineEntity: any = null;
  let pointEntities: any[] = [];
  let previewLineEntity: any = null;
  let closureEdgeEntity: any = null;
  let fillEntity: any = null;

  /** 获取 viewer 实例，已判空和销毁检查 */
  function getViewer(): Viewer | null {
    const v = toRaw(viewer.value);
    return isValidViewer(v) ? v : null;
  }

  /** 解析当前颜色 */
  function resolveColor(): string {
    return typeof colorOpt === 'function' ? colorOpt() : colorOpt;
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
        onLiveUpdate?.(positions.value, previewPos);
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
          snapping?.invalidateCache();
          previewPos = null;
          drawHelper();
          onLiveUpdate?.(positions.value, previewPos);
        }
      },
      ScreenSpaceEventType.LEFT_CLICK,
      KeyboardEventModifier.SHIFT,
    );

    // 鼠标移动：预览（使用 requestAnimationFrame 节流，避免高刷新率下的冗余计算）
    if (enablePreviewLine || enableClosurePreview) {
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
            onLiveUpdate?.(positions.value, previewPos);
            v2.canvas.style.cursor = !shiftPressed && finalPos !== cartesian ? 'copy' : 'crosshair';
          }
          _pendingMousePos = null;
        });
      }, ScreenSpaceEventType.MOUSE_MOVE);
    }

    // 右键：完成绘制
    handler.setInputAction(() => {
      finishDraw();
    }, ScreenSpaceEventType.RIGHT_CLICK);

    // 左键双击：完成绘制（无修饰键）
    handler.setInputAction((movement: any) => {
      if (positions.value.length < minVertices) return;
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
        if (positions.value.length < minVertices) return;
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

    if (positions.value.length < minVertices) {
      onCancel?.();
      return;
    }
    onFinish?.();
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
    onLiveUpdate?.(positions.value, previewPos);
  }

  /* ==============================
   *  可视化
   * ============================== */

  /** 重建折线、顶点和填充图形 */
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
    const color = Color.fromCssColorString(resolveColor());
    const n = pos.length;

    // 填充面
    if (enableFill && n >= minVertices) {
      fillEntity = v.entities.add({
        polygon: {
          hierarchy: [...pos],
          material: color.withAlpha(0.15),
          outline: false,
        },
      });
    }

    // 路径线
    if (n >= 2) {
      const linePositions = closePolyline ? [...pos, pos[0]] : [...pos];
      polylineEntity = v.entities.add({
        polyline: {
          positions: linePositions,
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

    const n = positions.value.length;
    const last = positions.value[n - 1];
    if (!last) return;

    const previewColor = Color.fromCssColorString(resolveColor()).withAlpha(0.4);

    // 下一条边（末点 → 鼠标）
    if (enablePreviewLine) {
      if (previewLineEntity) {
        previewLineEntity.polyline.positions = [last, mousePos];
      } else {
        previewLineEntity = v.entities.add({
          polyline: {
            positions: [last, mousePos],
            width: 2,
            material: previewColor,
            clampToGround: true,
          },
        });
      }
    }

    // 闭合边（鼠标 → 首点）
    if (enableClosurePreview && n >= 1) {
      const first = positions.value[0];
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
    if (previewLineEntity) {
      v.entities.remove(previewLineEntity);
      previewLineEntity = null;
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
