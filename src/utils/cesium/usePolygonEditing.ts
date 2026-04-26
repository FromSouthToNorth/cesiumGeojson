/* ==============================
 * Polygon Editing Composable
 * 闭合多边形顶点编辑：拖拽、添加、删除顶点
 *
 * 交互：
 *   LEFT_DOWN: 选中顶点拖拽开始
 *   MOUSE_MOVE: 拖拽顶点 + 光标反馈
 *   LEFT_UP: 释放顶点
 *   LEFT_CLICK: 点击中点添加顶点
 *   RIGHT_CLICK: 删除顶点
 *
 * 键盘：
 *   Escape / Enter: 退出编辑
 *   Delete / Backspace: 删除顶点
 *   Ctrl/Cmd+Z: 撤销
 *   Ctrl/Cmd+Shift+Z: 重做
 * ============================== */

import { ref, toRaw } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { Cartesian2, Cartesian3, Color, HeightReference, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';
import type { Viewer } from 'cesium';
import { message } from 'ant-design-vue';
import { isValidViewer, pickGlobe } from './clipCommon';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import type { ShortcutDef } from './useKeyboardShortcuts';

export function usePolygonEditing(options: {
  viewer: ComputedRef<Viewer | null>;
  positions: Ref<Cartesian3[]>;
  /** 颜色 getter，每次 drawEditGraphics 时调用，确保使用最新颜色 */
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
  let editPolygonEntity: any = null;
  let editPolylineEntity: any = null;
  let editPointEntities: any[] = [];
  let editMidpointEntities: any[] = [];
  let dragState: { index: number } | null = null;
  /** 拖拽刚结束时为 true，阻止 LEFT_CLICK 误触中点添加 */
  let justDragged = false;
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
    v.scene.screenSpaceCameraController.enableInputs = false;
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
    if (editPolygonEntity) { remove(editPolygonEntity); editPolygonEntity = null; }
    if (editPolylineEntity) { remove(editPolylineEntity); editPolylineEntity = null; }
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

    // 多边形半透明填充
    editPolygonEntity = v.entities.add({
      polygon: {
        hierarchy: [...pos],
        material: color.withAlpha(0.12),
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
    });

    // 多边形边线（闭合）
    editPolylineEntity = v.entities.add({
      polyline: {
        positions: [...pos, pos[0]],
        width: 2,
        material: color,
        clampToGround: true,
      },
    });

    // 顶点标记（黄色 + 白色描边）
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

    // 中点标记（绿色，可点击添加顶点）
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const mid = Cartesian3.midpoint(pos[i], pos[next], new Cartesian3());
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
      editPolylineEntity.polyline.positions = [...polyPos, polyPos[0]];
    }
    if (editPolygonEntity) {
      editPolygonEntity.polygon.hierarchy = [...polyPos];
    }

    // 更新相邻的两个中点
    const n = polyPos.length;
    const prev = (index - 1 + n) % n;
    const next = (index + 1) % n;

    if (editMidpointEntities[prev]) {
      editMidpointEntities[prev].position = Cartesian3.midpoint(polyPos[prev], polyPos[index], new Cartesian3());
    }
    if (editMidpointEntities[index]) {
      editMidpointEntities[index].position = Cartesian3.midpoint(polyPos[index], polyPos[next], new Cartesian3());
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
      justDragged = false; // 鼠标移动后清除拖拽标志
      lastMousePos = movement.endPosition;
      const v2 = getViewer();
      if (!v2) return;

      updateCursor(v2, movement.endPosition);

      if (!dragState) return;
      const cartesian = pickGlobe(v2, movement.endPosition);
      if (cartesian) {
        positions.value[dragState.index] = cartesian;
        updateEditVertex(dragState.index, cartesian);
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    /* LEFT_UP：结束拖拽 */
    editingHandler.setInputAction(() => {
      if (dragState) {
        dragState = null;
        justDragged = true; // 标记拖拽刚结束，阻止接下来的 LEFT_CLICK
        const v2 = getViewer();
        if (v2) v2.canvas.style.cursor = 'default';
        onChange?.();
        drawEditGraphics();
      }
    }, ScreenSpaceEventType.LEFT_UP);

    /* LEFT_CLICK：点击中点添加顶点 */
    editingHandler.setInputAction((click: any) => {
      if (dragState || justDragged) return;
      const v2 = getViewer();
      if (!v2) return;
      const picked = v2.scene.pick(click.position);
      if (picked?.id) {
        const idx = editMidpointEntities.indexOf(picked.id);
        if (idx !== -1) {
          const next = (idx + 1) % positions.value.length;
          const mid = Cartesian3.midpoint(positions.value[idx], positions.value[next], new Cartesian3());
          positions.value.splice(next, 0, mid);
          onChange?.();
          drawEditGraphics();
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    /* RIGHT_CLICK：右键删除顶点 */
    editingHandler.setInputAction((click: any) => {
      const v2 = getViewer();
      if (!v2) return;
      const picked = v2.scene.pick(click.position);
      if (picked?.id) {
        const idx = editPointEntities.indexOf(picked.id);
        if (idx !== -1) removeVertexByIndex(idx);
      }
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
    if (positions.value.length <= 3) {
      message.warning('至少需要 3 个顶点，无法继续删除');
      return;
    }
    positions.value.splice(idx, 1);
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
