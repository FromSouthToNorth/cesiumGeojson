/* ==============================
 * Path Editing Composable
 * 开放折线顶点编辑：拖拽、添加、删除顶点
 *
 * 与 usePolygonEditing 的区别：
 *   - 无 fill polygon（折线不需要）
 *   - 折线不闭合（不加首点）
 *   - 中点 n-1 条边（无闭合边）
 *   - 最小顶点 2 个
 * ============================== */

import { ref, toRaw, triggerRef } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { Cartesian2, Cartesian3, Color, HeightReference, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';
import type { Viewer } from 'cesium';
import { message } from 'ant-design-vue';
import { isValidViewer, pickGlobe } from '../shared/common';
import { useKeyboardShortcuts } from '../shared/useKeyboardShortcuts';
import type { ShortcutDef } from '../shared/useKeyboardShortcuts';

export function usePathEditing(options: {
  viewer: ComputedRef<Viewer | null>;
  positions: Ref<Cartesian3[]>;
  color?: () => string;
  onStart?: () => void;
  onChange?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  /** 键盘 Escape/Enter 退出编辑时回调（由 store 提供以同步更新实体 + 状态） */
  onExitEdit?: () => void;
}) {
  const { viewer, positions, color: colorGetter, onStart, onChange, onUndo, onRedo, onExitEdit } = options;
  const isEditing = ref(false);
  const getColor = colorGetter ?? (() => '#1890FF');

  /* ── 编辑内部状态 ── */
  let editingHandler: ScreenSpaceEventHandler | null = null;
  let editPolylineEntity: any = null;
  let editPointEntities: any[] = [];
  let editMidpointEntities: any[] = [];
  let dragState: { index: number } | null = null;
  let lastMousePos: Cartesian2 | null = null;

  function getViewer(): Viewer | null {
    const v = toRaw(viewer.value);
    return isValidViewer(v) ? v : null;
  }

  /* ==============================
   *  键盘快捷键
   * ============================== */

  function deleteVertexAtCursor() {
    const pos = lastMousePos;
    if (!pos) return;
    const v = getViewer();
    if (!v) return;
    const picked = v.scene.pick(pos);
    if (picked?.id) {
      const idx = editPointEntities.indexOf(picked.id);
      if (idx !== -1) removeVertexByIndex(idx);
    }
  }

  const kbShortcuts: ShortcutDef[] = [
    { key: 'Escape', handler: () => (onExitEdit ?? stopEdit)() },
    { key: 'Enter', handler: () => (onExitEdit ?? stopEdit)() },
    { key: 'Delete', handler: deleteVertexAtCursor },
    { key: 'Backspace', handler: deleteVertexAtCursor },
    { key: 'z', meta: true, handler: () => onUndo?.() },
    { key: 'z', meta: true, shift: true, handler: () => onRedo?.() },
  ];

  const kb = useKeyboardShortcuts(kbShortcuts);

  /* ==============================
   *  进入 / 退出编辑模式
   * ============================== */

  function startEdit() {
    const v = getViewer();
    if (!v) return;

    onStart?.();
    isEditing.value = true;

    drawEditGraphics();
    setupEditHandler();
    kb.setup();
  }

  function stopEdit() {
    const v = getViewer();
    if (v) {
      v.scene.screenSpaceCameraController.enableInputs = true;
      v.canvas.style.cursor = 'default';
    }

    isEditing.value = false;
    clearEditGraphics();
    destroyEditHandler();
    kb.teardown();
    dragState = null;
  }

  /* ==============================
   *  编辑图形渲染
   * ============================== */

  function clearEditGraphics() {
    const v = getViewer();
    if (!v) return;
    const remove = (e: any) => v.entities.remove(e);
    if (editPolylineEntity) {
      remove(editPolylineEntity);
      editPolylineEntity = null;
    }
    editPointEntities.forEach(remove);
    editPointEntities = [];
    editMidpointEntities.forEach(remove);
    editMidpointEntities = [];
  }

  function drawEditGraphics() {
    const v = getViewer();
    if (!v) return;
    clearEditGraphics();

    const pos = positions.value;
    const n = pos.length;
    const color = Color.fromCssColorString(getColor());

    // 折线边线（不闭合）
    editPolylineEntity = v.entities.add({
      polyline: {
        positions: [...pos],
        width: 2,
        material: color,
        clampToGround: true,
      },
    });

    // 顶点标记
    pos.forEach((p) => {
      editPointEntities.push(
        v.entities.add({
          position: p,
          point: {
            pixelSize: 11,
            color: Color.YELLOW,
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        }),
      );
    });

    // 中点标记（n-1 条边，无闭合边）
    for (let i = 0; i < n - 1; i++) {
      const mid = Cartesian3.midpoint(pos[i], pos[i + 1], new Cartesian3());
      editMidpointEntities.push(
        v.entities.add({
          position: mid,
          point: {
            pixelSize: 8,
            color: Color.LIME,
            outlineColor: Color.WHITE,
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        }),
      );
    }
  }

  /** 拖拽中原地更新顶点（不重建 entity） */
  function updateEditVertex(index: number, pos: Cartesian3) {
    const ent = editPointEntities[index];
    if (ent) ent.position = pos;

    const polyPos = positions.value;
    if (editPolylineEntity) {
      editPolylineEntity.polyline.positions = [...polyPos];
    }

    // 更新相邻中点（开放折线无 wrap-around）
    const n = polyPos.length;
    if (index > 0 && editMidpointEntities[index - 1]) {
      editMidpointEntities[index - 1].position = Cartesian3.midpoint(
        polyPos[index - 1],
        polyPos[index],
        new Cartesian3(),
      );
    }
    if (index < n - 1 && editMidpointEntities[index]) {
      editMidpointEntities[index].position = Cartesian3.midpoint(polyPos[index], polyPos[index + 1], new Cartesian3());
    }
  }

  /* ==============================
   *  事件处理器
   * ============================== */

  function setupEditHandler() {
    if (editingHandler) return;
    const v = getViewer();
    if (!v) return;

    editingHandler = new ScreenSpaceEventHandler(v.canvas);

    /* LEFT_DOWN：选中顶点开始拖拽 */
    editingHandler.setInputAction((click: any) => {
      const v2 = getViewer();
      if (!v2) return;
      const picked = v2.scene.pick(click.position);
      if (picked?.id) {
        const idx = editPointEntities.indexOf(picked.id);
        if (idx !== -1) {
          dragState = { index: idx };
          v2.canvas.style.cursor = 'grabbing';
        }
      }
    }, ScreenSpaceEventType.LEFT_DOWN);

    /* MOUSE_MOVE：拖拽 + 光标反馈 */
    editingHandler.setInputAction((movement: any) => {
      lastMousePos = movement.endPosition;
      const v2 = getViewer();
      if (!v2) return;

      if (dragState) {
        v2.scene.screenSpaceCameraController.enableInputs = false;
        const cartesian = pickGlobe(v2, movement.endPosition);
        if (cartesian) {
          positions.value[dragState.index] = cartesian;
          updateEditVertex(dragState.index, cartesian);
        }
      } else {
        v2.scene.screenSpaceCameraController.enableInputs = true;
        updateCursor(v2, movement.endPosition);
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    /* LEFT_UP：结束拖拽 */
    editingHandler.setInputAction(() => {
      if (dragState) {
        dragState = null;
        const v2 = getViewer();
        if (v2) v2.canvas.style.cursor = 'default';
        onChange?.();
        drawEditGraphics();
      }
    }, ScreenSpaceEventType.LEFT_UP);

    /* LEFT_CLICK：点击中点添加顶点 */
    editingHandler.setInputAction((click: any) => {
      if (dragState) return;
      const v2 = getViewer();
      if (!v2) return;
      const picked = v2.scene.pick(click.position);
      if (picked?.id) {
        const idx = editMidpointEntities.indexOf(picked.id);
        if (idx !== -1) {
          // 对于折线，中点 idx 对应边 positions[idx]→positions[idx+1]
          const next = idx + 1;
          if (next >= positions.value.length) return;
          const mid = Cartesian3.midpoint(positions.value[idx], positions.value[next], new Cartesian3());
          positions.value.splice(next, 0, mid);
          triggerRef(positions as any);
          onChange?.();
          drawEditGraphics();
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    /* RIGHT_CLICK：右键删除顶点 / 空白处退出编辑 */
    editingHandler.setInputAction((click: any) => {
      const v2 = getViewer();
      if (!v2) return;
      const picked = v2.scene.pick(click.position);
      if (picked?.id) {
        const idx = editPointEntities.indexOf(picked.id);
        if (idx !== -1) {
          removeVertexByIndex(idx);
          return;
        }
      }
      // 点击空白处 → 退出编辑
      (onExitEdit ?? stopEdit)();
    }, ScreenSpaceEventType.RIGHT_CLICK);
  }

  function destroyEditHandler() {
    if (editingHandler) {
      editingHandler.destroy();
      editingHandler = null;
    }
  }

  /* ==============================
   *  光标反馈
   * ============================== */

  function updateCursor(v: any, pos: Cartesian2) {
    if (dragState) {
      v.canvas.style.cursor = 'grabbing';
      return;
    }
    const picked = v.scene.pick(pos);
    if (!picked?.id) {
      v.canvas.style.cursor = 'default';
      return;
    }
    if (editPointEntities.indexOf(picked.id) !== -1) {
      v.canvas.style.cursor = 'grab';
    } else if (editMidpointEntities.indexOf(picked.id) !== -1) {
      v.canvas.style.cursor = 'pointer';
    } else {
      v.canvas.style.cursor = 'default';
    }
  }

  /* ==============================
   *  顶点操作
   * ============================== */

  function removeVertexByIndex(idx: number) {
    if (idx < 0 || idx >= positions.value.length) return;
    if (positions.value.length <= 2) {
      message.warning('至少需要 2 个顶点，无法继续删除');
      return;
    }
    positions.value.splice(idx, 1);
    triggerRef(positions as any);
    onChange?.();
    drawEditGraphics();
  }

  /* ==============================
   *  生命周期
   * ============================== */

  function destroy() {
    stopEdit();
    dragState = null;
    lastMousePos = null;
  }

  return {
    isEditing,
    startEdit,
    stopEdit,
    redraw: drawEditGraphics,
    destroy,
  };
}
