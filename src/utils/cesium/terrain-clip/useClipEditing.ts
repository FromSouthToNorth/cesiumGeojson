import { ref, toRaw } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { Cartesian2, Cartesian3, Color, HeightReference, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';
import type { Viewer } from 'cesium';
import { message } from 'ant-design-vue';
import { isValidViewer, pickGlobe } from '../shared/common';
import { useKeyboardShortcuts } from '../shared/useKeyboardShortcuts';
import type { ShortcutDef } from '../shared/useKeyboardShortcuts';

/**
 * 编辑模式 composable
 *
 * 职责：管理裁切多边形顶点编辑的全部交互逻辑。
 *
 * 交互功能：
 *   - 拖拽顶点：LEFT_DOWN 选中 → MOUSE_MOVE 拖拽 → LEFT_UP 释放
 *   - 添加顶点：点击线段中点（绿色点）
 *   - 删除顶点：右键点击顶点 或 悬停时按 Delete/Backspace
 *   - 键盘快捷键：Escape 退出编辑
 *
 * 视觉反馈：
 *   - 多边形半透明填充 + 青色边线
 *   - 顶点为黄色圆点（白色描边），中点为绿色圆点
 *   - 鼠标悬停时根据对象切换光标样式（grab/pointer/default）
 *
 * 使用方式：
 *   const editing = useClipEditing({ viewer, positions, onStart, onChange })
 */
export function useClipEditing(options: {
  /** Cesium Viewer 的 computed ref */
  viewer: ComputedRef<Viewer | null>;
  /** 当前活动区域的顶点数组 ref（与 regions[i].positions 共享引用） */
  positions: Ref<Cartesian3[]>;
  /** 进入编辑模式时回调（store 在此处 pushHistory 快照初始状态） */
  onStart?: () => void;
  /** 顶点发生变更时回调（store 在此处 pushHistory + syncGlobeClipping + saveToStorage） */
  onChange?: () => void;
  /** 撤销（Ctrl/Cmd+Z）回调 */
  onUndo?: () => void;
  /** 重做（Ctrl/Cmd+Shift+Z）回调 */
  onRedo?: () => void;
}) {
  const { viewer, positions, onStart, onChange, onUndo, onRedo } = options;
  /** 是否正在编辑中（UI 状态） */
  const isEditing = ref(false);

  /* ── 编辑内部状态 ── */
  // 编辑期间的鼠标事件处理器
  let editingHandler: ScreenSpaceEventHandler | null = null;

  // 可视化 entity
  let editPolygonEntity: any = null; // 多边形填充
  let editPolylineEntity: any = null; // 多边形边线
  let editPointEntities: any[] = []; // 顶点标记
  let editMidpointEntities: any[] = []; // 中点（可点击添加新顶点）

  // 拖拽状态
  let dragState: { index: number } | null = null;
  // 鼠标最后位置（用于 Delete 键拾取顶点）
  let lastMousePos: Cartesian2 | null = null;

  /** 获取 viewer 实例，已判空和销毁检查 */
  function getViewer(): Viewer | null {
    const v = toRaw(viewer.value);
    return isValidViewer(v) ? v : null;
  }

  /* ==============================
   *  键盘快捷键（通过 composable 声明）
   * ============================== */

  /** 删除鼠标悬停处的顶点（Delete / Backspace 共用） */
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
    { key: 'Escape', handler: () => stopEdit() },
    { key: 'Enter', handler: () => stopEdit() },
    { key: 'Delete', handler: deleteVertexAtCursor },
    { key: 'Backspace', handler: deleteVertexAtCursor },
    { key: 'z', meta: true, handler: () => onUndo?.() },
    { key: 'z', meta: true, shift: true, handler: () => onRedo?.() },
  ];

  const kb = useKeyboardShortcuts(kbShortcuts);

  /* ==============================
   *  进入 / 退出编辑模式
   * ============================== */

  /**
   * 进入编辑模式
   * 锁定相机（避免与顶点拖拽冲突），创建编辑图形并注册事件
   */
  function startEdit() {
    const v = getViewer();
    if (!v) return;

    // 通知 store 记录初始状态快照
    onStart?.();
    isEditing.value = true;

    drawEditGraphics();
    setupEditHandler();
    kb.setup();
  }

  /**
   * 退出编辑模式
   * 恢复相机控制，清除图形和事件
   */
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
    // 历史数据保留，以便用户退出编辑后仍可 undo/redo
  }

  /* ==============================
   *  编辑图形渲染
   * ============================== */

  /** 清除编辑模式的所有图形 entity */
  function clearEditGraphics() {
    const v = getViewer();
    if (!v) return;
    const remove = (e: any) => v.entities.remove(e);
    if (editPolygonEntity) {
      remove(editPolygonEntity);
      editPolygonEntity = null;
    }
    if (editPolylineEntity) {
      remove(editPolylineEntity);
      editPolylineEntity = null;
    }
    editPointEntities.forEach(remove);
    editPointEntities = [];
    editMidpointEntities.forEach(remove);
    editMidpointEntities = [];
  }

  /**
   * 重建编辑图形（完全重建）
   * 每次顶点变更后调用，确保 entity 与 positions 数据一致
   */
  function drawEditGraphics() {
    const v = getViewer();
    if (!v) return;
    clearEditGraphics();

    const pos = positions.value;
    const n = pos.length;

    // 多边形半透明填充
    editPolygonEntity = v.entities.add({
      polygon: {
        hierarchy: [...pos],
        material: Color.CYAN.withAlpha(0.12),
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
    });

    // 多边形边线（青色）
    editPolylineEntity = v.entities.add({
      polyline: {
        positions: [...pos, pos[0]],
        width: 2,
        material: Color.CYAN,
        clampToGround: true,
      },
    });

    // 顶点标记（黄色 + 白色描边，尺寸 11px）
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

    // 每条边的中点标记（绿色 + 白色描边，点击此处添加新顶点）
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

  /**
   * 拖拽中原地更新顶点位置（不重建 entity）
   * 只更新被拖拽顶点的坐标，以及相邻两条边的中点位置
   */
  function updateEditVertex(index: number, pos: Cartesian3) {
    // 更新顶点 entity 位置
    const ent = editPointEntities[index];
    if (ent) ent.position = pos;

    // 更新边线（复制数组刷新引用使 Cesium 响应）
    if (editPolylineEntity) {
      editPolylineEntity.polyline.positions = [...positions.value, positions.value[0]];
    }
    if (editPolygonEntity) {
      editPolygonEntity.polygon.hierarchy = [...positions.value];
    }

    // 更新相邻的两个中点
    const n = positions.value.length;
    const prev = (index - 1 + n) % n;
    const next = (index + 1) % n;

    if (editMidpointEntities[prev]) {
      const mp = Cartesian3.midpoint(positions.value[prev], positions.value[index], new Cartesian3());
      editMidpointEntities[prev].position = mp;
    }
    if (editMidpointEntities[index]) {
      const mp = Cartesian3.midpoint(positions.value[index], positions.value[next], new Cartesian3());
      editMidpointEntities[index].position = mp;
    }
  }

  /* ==============================
   *  事件处理器
   * ============================== */

  /**
   * 注册编辑期间的鼠标交互事件
   *   - LEFT_DOWN:  选中顶点开始拖拽
   *   - MOUSE_MOVE: 拖拽顶点 + 光标反馈
   *   - LEFT_UP:    释放顶点
   *   - LEFT_CLICK: 点击中点 → 添加顶点
   *   - RIGHT_CLICK: 点击顶点 → 删除
   */
  function setupEditHandler() {
    if (editingHandler) return;
    const v = getViewer();
    if (!v) return;

    editingHandler = new ScreenSpaceEventHandler(v.canvas);

    /* ── LEFT_DOWN：选中顶点，开始拖拽 ── */
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

    /* ── MOUSE_MOVE：更新拖拽 + 光标样式 ── */
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

    /* ── LEFT_UP：结束拖拽，触发回调 ── */
    editingHandler.setInputAction(() => {
      if (dragState) {
        dragState = null;
        const v2 = getViewer();
        if (v2) v2.canvas.style.cursor = 'default';
        // 通知 store 推历史、同步裁切、保存
        onChange?.();
        // 重建图形（确保 entity 与 positions 完全一致）
        drawEditGraphics();
      }
    }, ScreenSpaceEventType.LEFT_UP);

    /* ── LEFT_CLICK（非拖拽）：点击中点 → 插入新顶点 ── */
    editingHandler.setInputAction((click: any) => {
      if (dragState) return;
      const v2 = getViewer();
      if (!v2) return;
      const picked = v2.scene.pick(click.position);
      if (picked?.id) {
        const idx = editMidpointEntities.indexOf(picked.id);
        if (idx !== -1) {
          // 在中点所在边的 next 端插入新顶点
          const next = (idx + 1) % positions.value.length;
          const mid = Cartesian3.midpoint(positions.value[idx], positions.value[next], new Cartesian3());
          positions.value.splice(next, 0, mid);
          onChange?.();
          drawEditGraphics();
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    /* ── RIGHT_CLICK：右键删除顶点（非拖拽时） ── */
    editingHandler.setInputAction((click: any) => {
      const v2 = getViewer();
      if (!v2) return;
      const picked = v2.scene.pick(click.position);
      if (picked?.id) {
        const idx = editPointEntities.indexOf(picked.id);
        if (idx !== -1) {
          removeVertexByIndex(idx);
        }
      }
    }, ScreenSpaceEventType.RIGHT_CLICK);
  }

  /** 销毁编辑事件处理器 */
  function destroyEditHandler() {
    if (editingHandler) {
      editingHandler.destroy();
      editingHandler = null;
    }
  }

  /* ==============================
   *  光标反馈
   * ============================== */

  /**
   * 根据鼠标下方对象更新光标样式
   *   - 拖拽中：grabbing
   *   - 悬停顶点：grab
   *   - 悬停中点：pointer
   *   - 其他：default
   */
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

  /**
   * 按索引删除顶点
   * 最少保留 3 个顶点，不足时提示用户
   */
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

  /** 销毁编辑模式所有资源 */
  function destroy() {
    stopEdit();
    dragState = null;
    lastMousePos = null;
  }

  return {
    isEditing,
    startEdit,
    stopEdit,
    /** 重建编辑图形（用于 undo/redo 后刷新画面） */
    redraw: drawEditGraphics,
    destroy,
  };
}
