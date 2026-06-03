/* ==============================
 * 形状编辑 Composable（圆形 / 矩形）
 *
 * 圆形：中心点拖拽移动 + 半径控制点拖拽调整大小
 * 矩形：四个角点拖拽调整四至
 *
 * Esc/Enter 退出编辑
 * ============================== */

import { ref, toRaw } from 'vue';
import type { ComputedRef } from 'vue';
import {
  Cartesian3,
  Cartographic,
  Color,
  EllipsoidGeodesic,
  HeightReference,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Math as CesiumMath,
} from 'cesium';
import type { Viewer } from 'cesium';
import { isValidViewer, pickGlobe, toDeg } from '../shared/common';
import { useKeyboardShortcuts } from '../shared/useKeyboardShortcuts';
import type { ShortcutDef } from '../shared/useKeyboardShortcuts';

export type EditShapeType = 'geoCircle' | 'geoRectangle';

export interface ShapeEditContext {
  type: EditShapeType;
  entityId: string;
  color: string;
  center?: number[];
  radius?: number;
  bounds?: number[];
}

interface UseShapeEditingOptions {
  viewer: ComputedRef<Viewer | null>;
  onChange: (ctx: ShapeEditContext) => void;
  onExit: (finalCtx: ShapeEditContext) => void;
}

/** 预分配缓存，拖拽中零分配复用 */
const CIRCLE_SEGMENTS = 64;
const _ringCache: Cartesian3[] = [];
for (let i = 0; i <= CIRCLE_SEGMENTS; i++) _ringCache.push(new Cartesian3());
const _rectCornerCache: Cartesian3[] = [];
for (let i = 0; i < 5; i++) _rectCornerCache.push(new Cartesian3());
const _rectCtrlCache: Cartesian3[] = [];
for (let i = 0; i < 4; i++) _rectCtrlCache.push(new Cartesian3());
const _circleCtrlCache: Cartesian3[] = [new Cartesian3(), new Cartesian3()];

export function useShapeEditing(options: UseShapeEditingOptions) {
  const { viewer, onChange, onExit } = options;

  const isEditing = ref(false);

  let handler: ScreenSpaceEventHandler | null = null;
  let context: ShapeEditContext | null = null;
  let controlPointEntities: any[] = [];
  let outlineEntity: any = null;
  let dragIndex = -1;

  // RAF 节流
  let rafId: number | null = null;
  let pendingMousePos: import('cesium').Cartesian2 | null = null;

  function getViewer(): Viewer | null {
    const v = toRaw(viewer.value);
    return isValidViewer(v) ? v : null;
  }

  const shortcuts: ShortcutDef[] = [
    { key: 'Escape', handler: () => stopEdit() },
    { key: 'Enter', handler: () => stopEdit() },
  ];
  const kb = useKeyboardShortcuts(shortcuts);

  function buildCircleControlPoints(ctx: ShapeEditContext): Cartesian3[] {
    const c = ctx.center!;
    Cartesian3.fromDegrees(c[0], c[1], c[2] ?? 0, undefined, _circleCtrlCache[0]);
    const centerCarto = Cartographic.fromCartesian(_circleCtrlCache[0]);
    const radiusDeg = ctx.radius! / 111320 / Math.cos(centerCarto.latitude);
    Cartesian3.fromDegrees(c[0] + radiusDeg, c[1], c[2] ?? 0, undefined, _circleCtrlCache[1]);
    return _circleCtrlCache;
  }

  function buildRectangleControlPoints(ctx: ShapeEditContext): Cartesian3[] {
    const b = ctx.bounds!;
    Cartesian3.fromDegrees(b[0], b[1], undefined, undefined, _rectCtrlCache[0]);
    Cartesian3.fromDegrees(b[2], b[1], undefined, undefined, _rectCtrlCache[1]);
    Cartesian3.fromDegrees(b[2], b[3], undefined, undefined, _rectCtrlCache[2]);
    Cartesian3.fromDegrees(b[0], b[3], undefined, undefined, _rectCtrlCache[3]);
    return _rectCtrlCache;
  }

  function buildRectangleCorners(bounds: number[]): Cartesian3[] {
    Cartesian3.fromDegrees(bounds[0], bounds[1], undefined, undefined, _rectCornerCache[0]);
    Cartesian3.fromDegrees(bounds[2], bounds[1], undefined, undefined, _rectCornerCache[1]);
    Cartesian3.fromDegrees(bounds[2], bounds[3], undefined, undefined, _rectCornerCache[2]);
    Cartesian3.fromDegrees(bounds[0], bounds[3], undefined, undefined, _rectCornerCache[3]);
    Cartesian3.fromDegrees(bounds[0], bounds[1], undefined, undefined, _rectCornerCache[4]);
    return _rectCornerCache;
  }

  /** 生成圆形折线环（64 段），零分配复用 _ringCache */
  function buildCircleRing(center: number[], radius: number): Cartesian3[] {
    Cartesian3.fromDegrees(center[0], center[1], center[2] ?? 0, undefined, _circleCtrlCache[0]);
    const carto = Cartographic.fromCartesian(_circleCtrlCache[0]);
    const latDegFactor = radius / 111320;
    const lonDegFactor = radius / (111320 * Math.cos(carto.latitude));
    const lon0 = CesiumMath.toDegrees(carto.longitude);
    const lat0 = CesiumMath.toDegrees(carto.latitude);
    const h = carto.height;
    for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
      const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      Cartesian3.fromDegrees(
        lon0 + lonDegFactor * Math.sin(angle),
        lat0 + latDegFactor * Math.cos(angle),
        h,
        undefined,
        _ringCache[i],
      );
    }
    return _ringCache;
  }

  /** 创建所有编辑实体（仅在进入编辑模式时调用） */
  function createEditEntities() {
    const v = getViewer();
    if (!v || !context) return;

    // 隐藏原始实体，编辑期间只显示编辑轮廓
    const originalEntity = v.entities.getById(context.entityId);
    if (originalEntity) originalEntity.show = false;

    const color = Color.fromCssColorString(context.color);

    if (context.type === 'geoCircle') {
      const positions = buildCircleControlPoints(context);
      outlineEntity = v.entities.add({
        id: 'shape_edit_outline',
        polyline: {
          positions: buildCircleRing(context.center!, context.radius!),
          width: 2,
          material: color,
          clampToGround: true,
        },
      });
      positions.forEach((pos, idx) => {
        controlPointEntities.push(
          v.entities.add({
            id: `shape_edit_pt_${idx}`,
            position: pos,
            point: {
              pixelSize: 14,
              color: Color.YELLOW,
              outlineColor: Color.WHITE,
              outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            },
          }),
        );
      });
    } else {
      const positions = buildRectangleControlPoints(context);
      const closed = buildRectangleCorners(context.bounds!);
      outlineEntity = v.entities.add({
        id: 'shape_edit_outline',
        polyline: {
          positions: closed,
          width: 2,
          material: color,
          clampToGround: true,
        },
      });
      positions.forEach((pos, idx) => {
        controlPointEntities.push(
          v.entities.add({
            id: `shape_edit_pt_${idx}`,
            position: pos,
            point: {
              pixelSize: 14,
              color: Color.YELLOW,
              outlineColor: Color.WHITE,
              outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            },
          }),
        );
      });
    }
  }

  /** 原地更新编辑实体（拖拽过程中调用，避免每帧全量重建） */
  function updateEditPositions(positions: Cartesian3[]) {
    if (!context) return;
    positions.forEach((pos, idx) => {
      if (controlPointEntities[idx]) {
        controlPointEntities[idx].position = pos;
      }
    });
    if (context.type === 'geoCircle') {
      if (outlineEntity) {
        (outlineEntity.polyline as any).positions = buildCircleRing(context.center!, context.radius!);
      }
    } else if (outlineEntity) {
      (outlineEntity.polyline as any).positions = buildRectangleCorners(context.bounds!);
    }
  }

  /** 规范化矩形四至，防止拖拽角点越界导致 west>east 或 south>north */
  function normalizeRectBounds() {
    if (!context || context.type !== 'geoRectangle' || !context.bounds) return;
    const b = context.bounds;
    if (b[0] > b[2]) {
      [b[0], b[2]] = [b[2], b[0]];
      if (dragIndex === 0) dragIndex = 1;
      else if (dragIndex === 1) dragIndex = 0;
      else if (dragIndex === 2) dragIndex = 3;
      else if (dragIndex === 3) dragIndex = 2;
    }
    if (b[1] > b[3]) {
      [b[1], b[3]] = [b[3], b[1]];
      if (dragIndex === 0) dragIndex = 3;
      else if (dragIndex === 1) dragIndex = 2;
      else if (dragIndex === 2) dragIndex = 1;
      else if (dragIndex === 3) dragIndex = 0;
    }
  }

  function clearEditEntities() {
    const v = getViewer();
    if (!v) return;
    if (outlineEntity) {
      v.entities.remove(outlineEntity);
      outlineEntity = null;
    }
    controlPointEntities.forEach((e) => v.entities.remove(e));
    controlPointEntities = [];
  }

  function onLeftDown(movement: any) {
    const v = getViewer();
    if (!v) return;
    // drillPick 穿透叠加实体（如相邻多边形），确保能拾取到控制点
    const pickedList = v.scene.drillPick(movement.position);
    for (const picked of pickedList) {
      if (!picked.id) continue;
      const eid = (picked.id as any).id ?? '';
      const match = eid.match(/^shape_edit_pt_(\d+)$/);
      if (match) {
        dragIndex = parseInt(match[1], 10);
        (v.scene as any).screenSpaceCameraController.enableInputs = false;
        return;
      }
    }
  }

  function onMouseMove(movement: any) {
    if (dragIndex < 0 || !context) return;
    pendingMousePos = movement.endPosition;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const v = getViewer();
      if (!v || !pendingMousePos || dragIndex < 0) return;

      const cartesian = pickGlobe(v, pendingMousePos);
      pendingMousePos = null;
      if (!cartesian) return;

      if (context!.type === 'geoCircle') {
        if (dragIndex === 0) {
          const carto = Cartographic.fromCartesian(cartesian);
          context!.center = [toDeg(carto.longitude), toDeg(carto.latitude), carto.height ?? 0];
        } else {
          const centerPos = Cartesian3.fromDegrees(context!.center![0], context!.center![1], context!.center![2] ?? 0);
          const c = Cartographic.fromCartesian(centerPos);
          const e = Cartographic.fromCartesian(cartesian);
          context!.radius = new EllipsoidGeodesic(c, e).surfaceDistance;
        }
        updateEditPositions(buildCircleControlPoints(context!));
      } else {
        const carto = Cartographic.fromCartesian(cartesian);
        const lon = toDeg(carto.longitude);
        const lat = toDeg(carto.latitude);
        const b = context!.bounds!;
        if (dragIndex === 0) context!.bounds = [lon, lat, b[2], b[3]];
        else if (dragIndex === 1) context!.bounds = [b[0], lat, lon, b[3]];
        else if (dragIndex === 2) context!.bounds = [b[0], b[1], lon, lat];
        else context!.bounds = [lon, b[1], b[2], lat];
        normalizeRectBounds();
        updateEditPositions(buildRectangleControlPoints(context!));
      }
    });
  }

  function onLeftUp() {
    if (dragIndex >= 0) {
      const v = getViewer();
      if (v) (v.scene as any).screenSpaceCameraController.enableInputs = true;
      onChange({ ...context! });
      dragIndex = -1;
    }
  }

  function startEdit(ctx: ShapeEditContext) {
    if (isEditing.value) return;
    const v = getViewer();
    if (!isValidViewer(v)) return;

    context = {
      ...ctx,
      center: ctx.center ? [...ctx.center] : undefined,
      bounds: ctx.bounds ? [...ctx.bounds] : undefined,
    };
    isEditing.value = true;

    createEditEntities();

    handler = new ScreenSpaceEventHandler(v.scene.canvas);
    handler.setInputAction(onLeftDown, ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(onMouseMove, ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction(onLeftUp, ScreenSpaceEventType.LEFT_UP);
    handler.setInputAction(() => stopEdit(), ScreenSpaceEventType.RIGHT_CLICK);

    kb.setup();
  }

  function stopEdit() {
    if (dragIndex >= 0) {
      const v = getViewer();
      if (v) (v.scene as any).screenSpaceCameraController.enableInputs = true;
      dragIndex = -1;
    }

    const finalCtx = context
      ? {
          ...context,
          center: context.center ? [...context.center] : undefined,
          bounds: context.bounds ? [...context.bounds] : undefined,
        }
      : null;

    // 恢复原始实体可见性（必须在 context 清空之前）
    if (finalCtx) {
      const viewerRaw = getViewer();
      if (viewerRaw) {
        const originalEntity = viewerRaw.entities.getById(finalCtx.entityId);
        if (originalEntity) originalEntity.show = true;
      }
    }

    isEditing.value = false;
    context = null;

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pendingMousePos = null;

    handler?.destroy();
    handler = null;

    clearEditEntities();
    kb.teardown();

    if (finalCtx) onExit(finalCtx);
  }

  function destroy() {
    stopEdit();
  }

  return { isEditing, startEdit, stopEdit, destroy };
}
