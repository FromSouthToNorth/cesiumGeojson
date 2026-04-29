/* ==============================
 * useMapInteraction — 地图点击交互控制器
 * 全局左键弹出气泡 + 右键上下文菜单
 * 负责 Cesium 拾取、实体识别、状态管理
 * ============================== */

import { ref, toRaw, watch, type ComputedRef, type Ref } from 'vue';
import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  SceneTransforms,
  BoundingSphere,
  Cartesian3,
  Cartesian2,
  JulianDate,
} from 'cesium';
import type { Viewer, Entity } from 'cesium';
import { useGeoPolygonStore } from '@/stores/geoPolygonStore';
import { useGeoPathStore } from '@/stores/geoPathStore';
import { useGeoJsonStore } from '@/stores/geojsonStore';
import { useTerrainClipStore } from '@/stores/terrainClipStore';
import type { GeoJsonFeature, GeoJsonLayer } from '@/stores/geojsonStore';
import type { GeoPolygon } from '@/types/geoPolygon';
import type { GeoPath } from '@/types/geoPath';
import type { PopupVariantKey } from '@/components/Cesium/shared/popupVariants';
import { isValidViewer, pickGlobe } from './common';

/* ==============================
 *  类型定义
 * ============================== */

export type PickedEntityType = 'geoPolygon' | 'geoPath' | 'geojson' | 'point';

export interface PickedEntityGeoPolygon {
  type: 'geoPolygon';
  entity: Entity;
  polygon: GeoPolygon;
  position: Cartesian3;
}

export interface PickedEntityGeoPath {
  type: 'geoPath';
  entity: Entity;
  path: GeoPath;
  position: Cartesian3;
}

export interface PickedEntityGeoJson {
  type: 'geojson';
  entity: Entity;
  feature: GeoJsonFeature;
  layer: GeoJsonLayer;
  position: Cartesian3;
}

export interface PickedEntityPoint {
  type: 'point';
  entity: Entity;
  position: Cartesian3;
}

export type PickedEntity = PickedEntityGeoPolygon | PickedEntityGeoPath | PickedEntityGeoJson | PickedEntityPoint | null;

export interface ContextMenuAction {
  id: string;
  label: string;
}

export interface ContextActionEvent {
  action: ContextMenuAction;
  entity: PickedEntity;
}

export interface MapInteractionState {
  popupTarget: Ref<PickedEntity>;
  popupScreenPos: Ref<{ x: number; y: number } | null>;
  popupVisible: Ref<boolean>;
  popupStyle: Ref<PopupVariantKey>;
  contextMenuTarget: Ref<PickedEntity>;
  contextMenuPos: Ref<{ x: number; y: number }>;
  contextMenuVisible: Ref<boolean>;
  setup: () => void;
  teardown: () => void;
  closePopup: () => void;
  closeContextMenu: () => void;
}

/* ==============================
 *  辅助：获取实体的最佳 3D 位置
 * ============================== */

function getEntityPosition(entity: Entity): Cartesian3 | null {
  // 尝试直接读取 entity.position
  try {
    const pos = entity.position?.getValue(JulianDate.now());
    if (pos) return pos;
  } catch {
    // ignore
  }

  // 从图形几何计算包围球中心
  try {
    let positions: Cartesian3[] = [];

    if ((entity as any).polygon?.hierarchy?.getValue) {
      const hierarchy = (entity as any).polygon.hierarchy.getValue(JulianDate.now());
      if (hierarchy?.positions) {
        positions = hierarchy.positions;
      }
    } else if ((entity as any).polyline?.positions?.getValue) {
      positions = (entity as any).polyline.positions.getValue(JulianDate.now());
    }

    if (positions.length > 0) {
      return BoundingSphere.fromPoints(positions).center;
    }
  } catch {
    // ignore
  }

  return null;
}

/* ==============================
 *  辅助：判断是否为临时实体
 * ============================== */

const TEMP_ENTITY_PREFIXES = [
  'draw-',
  'edit-',
  'snap-',
  'playback_',
  'geoPolygon_draw_',
  'geoPath_draw_',
  'clip_draw_',
  'clip_edit_',
];

function isTempEntity(id: string): boolean {
  return TEMP_ENTITY_PREFIXES.some((p) => id.startsWith(p));
}

/** 坡度网格点 */
function isSlopeGridEntity(id: string): boolean {
  return /^geoPolygon_.+_slope_\d+$/.test(id);
}

/* ==============================
 *  辅助：检查是否有 store 正在绘制/编辑
 * ============================== */

function isAnyStoreBusy(): boolean {
  try {
    const polyStore = useGeoPolygonStore();
    if (polyStore.isDrawing || polyStore.isEditing || polyStore.isMoving) return true;
  } catch {
    // ignore
  }
  try {
    const pathStore = useGeoPathStore();
    if (pathStore.isDrawing || pathStore.isEditing || pathStore.isMoving) return true;
  } catch {
    // ignore
  }
  try {
    const clipStore = useTerrainClipStore();
    if (clipStore.isDrawing || clipStore.isEditing) return true;
  } catch {
    // ignore
  }
  return false;
}

/* ==============================
 *  核心拾取函数
 * ============================== */

function pickEntity(v: Viewer, screenPos: { x: number; y: number }): PickedEntity {
  const scene = v.scene;
  const picked = scene.pick(new Cartesian2(screenPos.x, screenPos.y));
  if (!picked || !picked.id) return null;

  const entity: Entity = picked.id;
  const entityId = (entity.id ?? '') as string;

  if (isTempEntity(entityId)) return null;
  if (isSlopeGridEntity(entityId)) return null;

  // 1. GeoPolygon
  const polyMatch = entityId.match(/^geoPolygon_([a-z0-9]+)$/);
  if (polyMatch) {
    try {
      const store = useGeoPolygonStore();
      const polygon = store.polygons.find((p) => p.id === polyMatch[1]);
      if (polygon) {
        const pos = getEntityPosition(entity) ?? BoundingSphere.fromPoints(polygon.positions).center;
        return { type: 'geoPolygon', entity, polygon, position: pos };
      }
    } catch {
      // ignore
    }
  }

  // 2. GeoPath
  const pathMatch = entityId.match(/^geoPath_([a-z0-9]+)/);
  if (pathMatch) {
    try {
      const store = useGeoPathStore();
      const path = store.paths.find((p) => p.id === pathMatch[1]);
      if (path) {
        const pos = getEntityPosition(entity) ?? BoundingSphere.fromPoints(path.positions).center;
        return { type: 'geoPath', entity, path, position: pos };
      }
    } catch {
      // ignore
    }
  }

  // 3. GeoJSON 要素（引用匹配）
  try {
    const geojsonStore = useGeoJsonStore();
    for (const layer of geojsonStore.layers) {
      for (const feature of layer.features) {
        if (feature.entity.id === entity.id) {
          const pos = getEntityPosition(entity) ?? new Cartesian3(0, 0, 0);
          return { type: 'geojson', entity, feature, layer, position: pos };
        }
      }
    }
  } catch {
    // ignore
  }

  // 4. 观测点
  const pointMatch = entityId.match(/^point_(\d+)$/);
  if (pointMatch) {
    const pos = getEntityPosition(entity) ?? new Cartesian3(0, 0, 0);
    return { type: 'point', entity, position: pos };
  }

  return null;
}

/* ==============================
 *  Composable
 * ============================== */

export function useMapInteraction(options: { viewer: ComputedRef<Viewer | null> }): MapInteractionState {
  const { viewer } = options;

  /* ─── 状态 ─── */

  const popupTarget = ref<PickedEntity>(null);
  const popupScreenPos = ref<{ x: number; y: number } | null>(null);
  const popupVisible = ref(false);
  const popupStyle = ref<PopupVariantKey>('glass');

  const contextMenuTarget = ref<PickedEntity>(null);
  const contextMenuPos = ref<{ x: number; y: number }>({ x: 0, y: 0 });
  const contextMenuVisible = ref(false);

  /* ─── 内部 ─── */

  let handler: ScreenSpaceEventHandler | null = null;
  let removePostRender: (() => void) | null = null;
  let trackedPosition: Cartesian3 | null = null;

  /* ─── 屏幕位置更新 ─── */

  let _lastPopupPos: { x: number; y: number } | null = null;

  function updatePopupScreenPos() {
    if (!popupVisible.value || !trackedPosition) {
      if (popupScreenPos.value !== null) popupScreenPos.value = null;
      return;
    }
    const v = toRaw(viewer.value);
    if (!v || v.isDestroyed()) {
      if (popupScreenPos.value !== null) popupScreenPos.value = null;
      return;
    }
    const pos = SceneTransforms.worldToWindowCoordinates(v.scene, trackedPosition);
    if (pos) {
      const newPos = { x: pos.x, y: pos.y };
      // 脏检查：仅当位置发生变化时才触发 Vue 更新
      if (!_lastPopupPos || _lastPopupPos.x !== newPos.x || _lastPopupPos.y !== newPos.y) {
        _lastPopupPos = newPos;
        popupScreenPos.value = newPos;
      }
    } else if (popupScreenPos.value !== null) {
      popupScreenPos.value = null;
    }
  }

  /* ─── 关闭 ─── */

  function closePopup() {
    popupVisible.value = false;
    popupTarget.value = null;
    popupScreenPos.value = null;
    trackedPosition = null;
  }

  function closeContextMenu() {
    contextMenuVisible.value = false;
    contextMenuTarget.value = null;
  }

  /* ─── 辅助：获取点击处表面位置 ─── */

  function getClickPosition(v: Viewer, screenPos: { x: number; y: number }): Cartesian3 | null {
    const cartesian2 = new Cartesian2(screenPos.x, screenPos.y);
    // 1. 深度缓冲拾取（实体表面最精确）
    try {
      const pos = v.scene.pickPosition(cartesian2);
      if (pos) return pos;
    } catch {
      // ignore
    }
    // 2. 地形射线 → 椭球面交点
    return pickGlobe(v, cartesian2);
  }

  /* ─── 左键 ─── */

  function onLeftClick(movement: { position: { x: number; y: number } }) {
    if (isAnyStoreBusy()) return;

    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    closeContextMenu();

    const picked = pickEntity(v, movement.position);
    if (picked) {
      popupTarget.value = picked;
      // 优先使用实际点击位置，回退到实体中心
      trackedPosition = getClickPosition(v, movement.position) ?? picked.position;
      popupVisible.value = true;
      updatePopupScreenPos();
    } else {
      closePopup();
    }
  }

  /* ─── 右键 ─── */

  let rightMouseDownPos: { x: number; y: number } | null = null;

  function onRightDown(movement: { position: { x: number; y: number } }) {
    rightMouseDownPos = movement.position;
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();

    // 过滤拖拽（用户右击拖拽是缩放操作，不弹出菜单）
    if (rightMouseDownPos) {
      // rightMouseDownPos 为 canvas 坐标, e.clientX/Y 为视口坐标
      // cesiumContainer 占满视口时两者等价，5px 阈值足够容忍微小偏差
      const dx = e.clientX - rightMouseDownPos.x;
      const dy = e.clientY - rightMouseDownPos.y;
      rightMouseDownPos = null;
      if (dx * dx + dy * dy > 25) return; // >5px 视为拖拽
    }

    if (isAnyStoreBusy()) return;

    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    closePopup();

    const rect = v.scene.canvas.getBoundingClientRect();
    const canvasPos = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    const picked = pickEntity(v, canvasPos);
    if (picked) {
      contextMenuTarget.value = picked;
      contextMenuPos.value = { x: e.clientX, y: e.clientY };
      contextMenuVisible.value = true;
    } else {
      closeContextMenu();
    }
  }

  /* ─── 生命周期 ─── */

  function setup() {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    v.scene.canvas.addEventListener('contextmenu', onContextMenu);

    handler = new ScreenSpaceEventHandler(v.scene.canvas);
    handler.setInputAction(onLeftClick, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(onRightDown, ScreenSpaceEventType.RIGHT_DOWN);

    const postRenderListener = () => updatePopupScreenPos();
    v.scene.postRender.addEventListener(postRenderListener);
    removePostRender = () => {
      try {
        v.scene.postRender.removeEventListener(postRenderListener);
      } catch {
        // ignore
      }
    };
  }

  function teardown() {
    try {
      handler?.destroy();
    } catch {
      // ignore
    }
    handler = null;
    removePostRender?.();
    removePostRender = null;
    closePopup();
    closeContextMenu();
  }

  /* ─── viewer 销毁时自动清理 ─── */

  watch(
    () => viewer.value,
    (v) => {
      if (!v || v.isDestroyed()) {
        teardown();
      }
    },
  );

  return {
    popupTarget,
    popupScreenPos,
    popupVisible,
    popupStyle,
    contextMenuTarget,
    contextMenuPos,
    contextMenuVisible,
    setup,
    teardown,
    closePopup,
    closeContextMenu,
  };
}
