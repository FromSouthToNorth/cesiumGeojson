/* ==============================
 * useEntityMove — 实体移动交互（优化版）
 * 支持幽灵预览、原实体高亮、鼠标跟踪、撤销
 * ============================== */

import { ref, toRaw } from 'vue';
import type { ComputedRef } from 'vue';
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Color,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from 'cesium';
import type { Viewer, Entity } from 'cesium';
import { isValidViewer, pickGlobe } from './common';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import type { ShortcutDef } from './useKeyboardShortcuts';

/* ==============================
 *  类型定义
 * ============================== */

export interface MoveContext {
  id: string;
  positions: Cartesian3[];
  color: string;
  type: 'geoPolygon' | 'geoPath';
}

interface EntityMoveOptions {
  viewer: ComputedRef<Viewer | null>;
  onConfirm: (id: string, newPositions: Cartesian3[]) => void;
  onCancel?: () => void;
}

interface SavedEntityStyle {
  material?: any;
  outlineColor?: any;
  outlineWidth?: any;
  width?: any;
}

export function useEntityMove(options: EntityMoveOptions) {
  const { viewer, onConfirm, onCancel } = options;
  const isMoving = ref(false);

  let handler: ScreenSpaceEventHandler | null = null;
  let context: MoveContext | null = null;
  let originalPositions: Cartesian3[] = [];
  let originalCenter: Cartesian3 = new Cartesian3();
  let ghostEntity: Entity | null = null;
  let originalEntity: Entity | null = null;
  let savedStyle: SavedEntityStyle = {};

  /* ─── 快捷键 ─── */

  const shortcuts: ShortcutDef[] = [{ key: 'Escape', handler: cancelMove }];

  const kb = useKeyboardShortcuts(shortcuts);

  /* ─── 幽灵实体创建 ─── */

  function createGhostEntity(ctx: MoveContext) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    const color = Color.fromCssColorString(ctx.color);

    if (ctx.type === 'geoPolygon') {
      ghostEntity = v.entities.add({
        polygon: {
          hierarchy: ctx.positions,
          material: color.withAlpha(0.2),
          outline: true,
          outlineColor: color.withAlpha(0.4),
          outlineWidth: 2,
        },
      });
    } else {
      ghostEntity = v.entities.add({
        polyline: {
          positions: ctx.positions,
          width: 6,
          material: color.withAlpha(0.4),
          clampToGround: true,
        },
      });
    }
  }

  /* ─── 原实体高亮 ─── */

  function highlightOriginal(ctx: MoveContext) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    const entityId = `${ctx.type}_${ctx.id}`;
    const entity = v.entities.getById(entityId) ?? null;
    if (!entity) return;
    originalEntity = entity;

    if (ctx.type === 'geoPolygon' && entity.polygon) {
      const poly = entity.polygon as any;
      // 保存原始 Property 对象（而非调用 getValue() 得到普通对象），
      // 避免 restore 时 Cesium 的 setter 无法推断 material 类型
      savedStyle.material = poly.material;
      savedStyle.outlineColor = poly.outlineColor;
      savedStyle.outlineWidth = poly.outlineWidth;

      const color = Color.fromCssColorString(ctx.color);
      poly.outlineColor = color.withAlpha(0.9);
      poly.outlineWidth = 4;
      poly.material = color.withAlpha(0.4);
    } else if (ctx.type === 'geoPath' && entity.polyline) {
      const pl = entity.polyline as any;
      savedStyle.width = pl.width;
      pl.width = 5;
    }
  }

  function restoreOriginalHighlight() {
    if (!originalEntity) return;

    if (originalEntity.polygon) {
      const poly = originalEntity.polygon as any;
      if (savedStyle.material !== undefined) poly.material = savedStyle.material;
      if (savedStyle.outlineColor !== undefined) poly.outlineColor = savedStyle.outlineColor;
      if (savedStyle.outlineWidth !== undefined) poly.outlineWidth = savedStyle.outlineWidth;
    } else if (originalEntity.polyline) {
      const pl = originalEntity.polyline as any;
      if (savedStyle.width !== undefined) pl.width = savedStyle.width;
    }

    originalEntity = null;
    savedStyle = {};
  }

  /* ─── 更新幽灵位置 ─── */

  function updateGhost(globePos: Cartesian3) {
    if (!context || !ghostEntity) return;

    const delta = Cartesian3.subtract(globePos, originalCenter, new Cartesian3());
    const newPositions = originalPositions.map((pos) =>
      Cartesian3.add(pos, delta, new Cartesian3()),
    );

    if (context.type === 'geoPolygon' && ghostEntity.polygon) {
      (ghostEntity.polygon as any).hierarchy = newPositions;
    } else if (context.type === 'geoPath' && ghostEntity.polyline) {
      (ghostEntity.polyline as any).positions = newPositions;
    }
  }

  /* ─── 确认移动 ─── */

  function confirmMove(globePos: Cartesian3) {
    if (!context) return;

    const delta = Cartesian3.subtract(globePos, originalCenter, new Cartesian3());
    const newPositions = originalPositions.map((pos) =>
      Cartesian3.add(pos, delta, new Cartesian3()),
    );

    onConfirm(context.id, newPositions);
    cleanup();
  }

  /* ─── 取消 ─── */

  function cancelMove() {
    cleanup();
    onCancel?.();
  }

  /* ─── 清理 ─── */

  function cleanup() {
    if (ghostEntity) {
      const v = toRaw(viewer.value);
      if (v && !v.isDestroyed()) {
        v.entities.remove(ghostEntity);
      }
      ghostEntity = null;
    }

    restoreOriginalHighlight();

    handler?.destroy();
    handler = null;

    kb.teardown();

    context = null;
    originalPositions = [];
    originalCenter = new Cartesian3();
    isMoving.value = false;
  }

  /* ─── 事件处理 ─── */

  function onMouseMove(movement: { endPosition: Cartesian2 }) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v) || !context) return;

    const globePos = pickGlobe(v, movement.endPosition);
    if (globePos) {
      updateGhost(globePos);
    }
  }

  function onLeftClick(movement: { position: { x: number; y: number } }) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v) || !context) return;

    const globePos = pickGlobe(v, new Cartesian2(movement.position.x, movement.position.y));
    if (globePos) {
      confirmMove(globePos);
    }
    // pickGlobe 失败（点击天空）则停留在移动模式
  }

  function onRightClick() {
    cancelMove();
  }

  /* ─── 开始移动 ─── */

  function startMove(ctx: MoveContext) {
    if (isMoving.value) return;
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    context = ctx;
    originalPositions = ctx.positions.map((p) => Cartesian3.clone(p));
    originalCenter = BoundingSphere.fromPoints(ctx.positions).center;

    createGhostEntity(ctx);
    highlightOriginal(ctx);

    handler = new ScreenSpaceEventHandler(v.scene.canvas);
    handler.setInputAction(onMouseMove, ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction(onLeftClick, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(onRightClick, ScreenSpaceEventType.RIGHT_CLICK);

    kb.setup();
    isMoving.value = true;
  }

  function stopMove() {
    cancelMove();
  }

  return { isMoving, startMove, stopMove };
}
