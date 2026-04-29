import { ref, toRaw, triggerRef } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { Cartesian3, Color, HeightReference, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';
import type { Viewer } from 'cesium';
import { isValidViewer, pickGlobe } from '../shared/common';
import { useKeyboardShortcuts } from '../shared/useKeyboardShortcuts';
import type { ShortcutDef } from '../shared/useKeyboardShortcuts';

/**
 * 绘制模式 composable
 *
 * 职责：管理"绘制裁切多边形"阶段的交互逻辑。
 *
 * 交互流程：
 *   1. 用户点击"开始绘制区域" → startDraw()
 *   2. 左键单击添加顶点，左键双击撤销上一个顶点
 *   3. 右键（或左键双击闭合距首点 < 5m）→ finishDraw()
 *   4. 绘制过程中实时显示顶点标记和辅助线段
 *
 * 使用方式（由 store 实例化，不单独使用）：
 *   const drawing = useClipDrawing({ viewer, positions, onFinish, onCancel })
 */
export function useClipDrawing(options: {
  /** Cesium Viewer 的 computed ref */
  viewer: ComputedRef<Viewer | null>;
  /** 当前活动区域的顶点数组 ref（与 regions[i].positions 共享引用） */
  positions: Ref<Cartesian3[]>;
  /** 绘制完成回调（顶点 >= 3） */
  onFinish?: () => void;
  /** 绘制取消回调（顶点 < 3 或用户取消） */
  onCancel?: () => void;
}) {
  const { viewer, positions, onFinish, onCancel } = options;
  /** 是否正在绘制中（UI 状态） */
  const isDrawing = ref(false);

  /* ── 内部状态 ── */
  // ScreenSpaceEventHandler，管理绘制期间的鼠标事件
  let handler: ScreenSpaceEventHandler | null = null;
  // 辅助线（折线）entity
  let polylineEntity: any = null;
  // 顶点标记点 entity 数组
  let pointEntities: any[] = [];

  /** 获取 viewer 实例，已判空和销毁检查 */
  function getViewer(): Viewer | null {
    const v = toRaw(viewer.value);
    return isValidViewer(v) ? v : null;
  }

  /* ==============================
   *  键盘快捷键
   * ============================== */

  const drawShortcuts: ShortcutDef[] = [
    { key: 'Escape', handler: () => cancelDraw() },
    { key: 'Backspace', handler: () => undoLastVertex() },
    { key: 'Enter', handler: () => finishDraw() },
  ];

  const kb = useKeyboardShortcuts(drawShortcuts);

  /* ───────── 绘制控制 ───────── */

  /**
   * 开始绘制模式
   * 注册鼠标事件：左键加点、左键双击撤销、右键结束绘制
   */
  function startDraw() {
    const v = getViewer();
    if (!v) return;
    if (isDrawing.value) return;

    // 清理旧的残留图形（安全防护）
    clearDrawGraphics();
    isDrawing.value = true;

    handler = new ScreenSpaceEventHandler(v.canvas);

    // 左键单击：在点击位置添加顶点，更新辅助图形
    handler.setInputAction((movement: any) => {
      const v2 = getViewer();
      if (!v2) return;
      const cartesian = pickGlobe(v2, movement.position);
      if (cartesian) {
        positions.value.push(Cartesian3.clone(cartesian));
        triggerRef(positions as any);
        drawHelper();
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    // 左键双击：距末点 < 5m 视为闭合完成，否则撤销上一个顶点
    handler.setInputAction((movement: any) => {
      const v2 = getViewer();
      if (!v2) return;
      const cartesian = pickGlobe(v2, movement.position);
      if (cartesian && positions.value.length > 0) {
        const dist = Cartesian3.distance(cartesian, positions.value[positions.value.length - 1]);
        if (dist < 5) {
          finishDraw();
          return;
        }
      }
      undoLastVertex();
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // 右键：结束绘制
    handler.setInputAction(() => {
      finishDraw();
    }, ScreenSpaceEventType.RIGHT_CLICK);

    kb.setup();
  }

  /**
   * 完成绘制（内部调用）
   * 顶点 < 3 时触发 onCancel 回退，否则触发 onFinish
   */
  function finishDraw() {
    cleanupDraw();
    // 顶点不足 3 个，通过 onCancel 让 store 清理该区域
    if (positions.value.length < 3) {
      onCancel?.();
      return;
    }
    onFinish?.();
  }

  /** 清理绘制资源：销毁 handler、清除图形、重置状态 */
  function cleanupDraw() {
    isDrawing.value = false;
    if (handler) {
      handler.destroy();
      handler = null;
    }
    clearDrawGraphics();
    kb.teardown();
  }

  /**
   * 取消绘制（用户主动取消）
   * 清理图形并触发 onCancel，由 store 移除该区域
   */
  function cancelDraw() {
    cleanupDraw();
    onCancel?.();
  }

  /** 撤销最后一个顶点（用于双击撤销或外部调用） */
  function undoLastVertex() {
    if (positions.value.length === 0) return;
    positions.value.pop();
    triggerRef(positions as any);
    drawHelper();
  }

  /* ───────── 辅助图形 ───────── */

  /**
   * 绘制辅助图形（顶点标记 + 闭合折线）
   * 每次调用都会完全重建所有图形
   */
  function drawHelper() {
    const v = getViewer();
    if (!v) return;

    // 清除旧图形
    if (polylineEntity) {
      v.entities.remove(polylineEntity);
      polylineEntity = null;
    }
    pointEntities.forEach((e) => v.entities.remove(e));
    pointEntities = [];

    // 绘制顶点标记（黄色圆点）
    const pos = positions.value;
    pos.forEach((p) => {
      pointEntities.push(
        v.entities.add({
          position: p,
          point: {
            pixelSize: 8,
            color: Color.YELLOW,
            // 禁用深度测试，确保标记始终可见
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        }),
      );
    });

    // > 1 个顶点时绘制闭合辅助线（首尾相接）
    if (pos.length > 1) {
      polylineEntity = v.entities.add({
        polyline: {
          positions: [...pos, pos[0]],
          width: 2,
          material: Color.YELLOW,
          clampToGround: true,
        },
      });
    }
  }

  /** 清除绘制阶段的辅助图形 */
  function clearDrawGraphics() {
    const v = getViewer();
    if (!v) return;
    if (polylineEntity) {
      v.entities.remove(polylineEntity);
      polylineEntity = null;
    }
    pointEntities.forEach((e) => v.entities.remove(e));
    pointEntities = [];
  }

  /* ───────── 生命周期 ───────── */

  /** 销毁事件处理器并清除图形 */
  function destroy() {
    cleanupDraw();
  }

  return {
    isDrawing,
    startDraw,
    cancelDraw,
    undoLastVertex,
    destroy,
  };
}
