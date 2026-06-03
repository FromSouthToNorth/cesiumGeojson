/* ==============================
 * 形状 Store（圆形 / 矩形）
 *
 * 协调器：组合 useShapeDrawing composable，管理圆形和矩形的 CRUD、Cesium 实体、
 *          可见性切换和 GeoJSON 导出。
 *
 * 架构：
 *   geoShapeStore (coordinator)
 *     └── useShapeDrawing (两点击绘制)
 *
 * 本期不支持编辑/移动（后续 P1）
 * ============================== */

import { ref, toRaw, computed } from 'vue';
import type { ComputedRef } from 'vue';
import { Cartesian2, Cartesian3, Cartographic, Color, HeightReference, Rectangle } from 'cesium';
import { defineStore } from 'pinia';
import { message } from 'ant-design-vue';
import { useCesiumStore } from './cesiumStore';
import { isValidViewer, genId, formatDist, toDeg, calcGeoRectangleSize } from '@/utils/cesium/shared/common';
import { useShapeDrawing } from '@/utils/cesium/shape/useShapeDrawing';
import type { GeoCircle, GeoRectangle, ActiveShapeTool } from '@/types/geoShape';
import type { CircleDrawResult, RectangleDrawResult } from '@/utils/cesium/shape/useShapeDrawing';

/** 8 色调色板（与路径/多边形一致） */
const COLORS = ['#FF4D4F', '#52C41A', '#1890FF', '#FAAD14', '#722ED1', '#13C2C2', '#EB2F96', '#FA541C'];

function nextColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

export const useGeoShapeStore = defineStore('geoShape', () => {
  const cesiumStore = useCesiumStore();
  const viewer = computed(() => cesiumStore.viewer);

  /* ==============================
   *  状态
   * ============================== */

  const circles = ref<GeoCircle[]>([]);
  const rectangles = ref<GeoRectangle[]>([]);
  const isDrawing = ref(false);
  const activeTool = ref<ActiveShapeTool>(null);
  /** 绘制中的实时测量值 */
  const liveMeasure = ref<{ value1: number; value2: number } | null>(null);

  const hasShapes = computed(() => circles.value.length > 0 || rectangles.value.length > 0);

  /* ==============================
   *  实体管理
   * ============================== */

  function createCircleEntity(circle: GeoCircle) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const color = Color.fromCssColorString(circle.color);
    const center = Cartesian3.fromDegrees(circle.center[0], circle.center[1], circle.center[2] ?? 0);
    v.entities.add({
      id: `geoCircle_${circle.id}`,
      position: center,
      ellipse: {
        semiMajorAxis: circle.radius,
        semiMinorAxis: circle.radius,
        material: color.withAlpha(0.3),
        outline: true,
        outlineColor: color,
        outlineWidth: 2,
      },
      label: {
        text: `${circle.name}\nR: ${formatDist(circle.radius)}`,
        font: '14px sans-serif',
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: new Color(0, 0, 0, 0.6),
        pixelOffset: new Cartesian2(0, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  function createRectangleEntity(rect: GeoRectangle) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const color = Color.fromCssColorString(rect.color);
    v.entities.add({
      id: `geoRectangle_${rect.id}`,
      rectangle: {
        coordinates: Rectangle.fromDegrees(rect.west, rect.south, rect.east, rect.north),
        material: color.withAlpha(0.3),
        outline: true,
        outlineColor: color,
        outlineWidth: 2,
        height: rect.height,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: `${rect.name}`,
        font: '14px sans-serif',
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: new Color(0, 0, 0, 0.6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  function updateCircleEntity(id: string, circle: GeoCircle) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const entity = v.entities.getById(`geoCircle_${id}`);
    if (!entity) return;
    (entity.ellipse as any).semiMajorAxis = circle.radius;
    (entity.ellipse as any).semiMinorAxis = circle.radius;
    (entity.position as any) = Cartesian3.fromDegrees(circle.center[0], circle.center[1], circle.center[2] ?? 0);
  }

  function updateRectangleEntity(id: string, rect: GeoRectangle) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const entity = v.entities.getById(`geoRectangle_${id}`);
    if (!entity) return;
    // 规范化四至防止 Cesium 报错（拖拽角点越界时可能反转）
    const west = Math.min(rect.west, rect.east);
    const east = Math.max(rect.west, rect.east);
    const south = Math.min(rect.south, rect.north);
    const north = Math.max(rect.south, rect.north);
    (entity.rectangle as any).coordinates = Rectangle.fromDegrees(west, south, east, north);
    if (rect.height !== undefined) (entity.rectangle as any).height = rect.height;
  }

  function removeShapeEntity(prefix: string, id: string) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const entity = v.entities.getById(`${prefix}_${id}`);
    if (entity) v.entities.remove(entity);
  }

  /* ==============================
   *  绘制
   * ============================== */

  /** 当前绘制 composable 的取消函数，用于从面板手动取消 */
  let currentCancelDraw: (() => void) | null = null;

  function startDraw(tool: 'circle' | 'rectangle') {
    if (isDrawing.value) return;
    if (!isValidViewer(toRaw(viewer.value))) return;
    const colorStr = nextColor();
    const { startDraw: begin, cancelDraw } = useShapeDrawing({
      viewer: viewer as ComputedRef<import('cesium').Viewer | null>,
      type: tool,
      color: colorStr,
      onLiveUpdate: (data) => {
        liveMeasure.value = data;
      },
      onFinish: (result: CircleDrawResult | RectangleDrawResult) => {
        if (tool === 'circle') {
          const r = result as CircleDrawResult;
          const c = Cartographic.fromCartesian(r.center);
          const circle: GeoCircle = {
            id: genId(),
            name: `圆形 ${circles.value.length + 1}`,
            center: [toDeg(c.longitude), toDeg(c.latitude), c.height ?? 0],
            radius: r.radius,
            color: colorStr,
            visible: true,
            createdAt: new Date().toISOString(),
          };
          circles.value = [...circles.value, circle];
          createCircleEntity(circle);
          message.success(`"${circle.name}" 绘制完成，半径 ${circle.radius.toFixed(1)} m`);
        } else {
          const r = result as RectangleDrawResult;
          const rect: GeoRectangle = {
            id: genId(),
            name: `矩形 ${rectangles.value.length + 1}`,
            west: r.bounds[0],
            south: r.bounds[1],
            east: r.bounds[2],
            north: r.bounds[3],
            color: colorStr,
            visible: true,
            createdAt: new Date().toISOString(),
          };
          rectangles.value = [...rectangles.value, rect];
          createRectangleEntity(rect);
          const { width, height } = calcGeoRectangleSize(rect);
          message.success(`"${rect.name}" 绘制完成，${formatDist(width)} × ${formatDist(height)}`);
        }
        isDrawing.value = false;
        activeTool.value = null;
        currentCancelDraw = null;
        liveMeasure.value = null;
      },
      onCancel: () => {
        isDrawing.value = false;
        activeTool.value = null;
        currentCancelDraw = null;
        liveMeasure.value = null;
      },
    });
    currentCancelDraw = cancelDraw;
    activeTool.value = tool;
    isDrawing.value = true;
    begin();
  }

  /** 从面板取消当前绘制（清理 composable 资源 + 重置状态） */
  function cancelShapeDraw() {
    currentCancelDraw?.();
    isDrawing.value = false;
    activeTool.value = null;
    currentCancelDraw = null;
  }

  /* ==============================
   *  CRUD
   * ============================== */

  function removeCircle(id: string) {
    const circle = circles.value.find((c) => c.id === id);
    if (!circle) return;
    removeShapeEntity('geoCircle', id);
    circles.value = circles.value.filter((c) => c.id !== id);
    message.success(`已删除"${circle.name}"`);
  }

  function removeRectangle(id: string) {
    const rect = rectangles.value.find((r) => r.id === id);
    if (!rect) return;
    removeShapeEntity('geoRectangle', id);
    rectangles.value = rectangles.value.filter((r) => r.id !== id);
    message.success(`已删除"${rect.name}"`);
  }

  function clearAll() {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) {
      circles.value = [];
      rectangles.value = [];
      return;
    }
    // 一次遍历批量移除，避免逐个 remove 触发多次 Cesium 内部更新
    const toRemove: any[] = [];
    const prefixSet = new Set(
      circles.value.map((c) => `geoCircle_${c.id}`).concat(rectangles.value.map((r) => `geoRectangle_${r.id}`)),
    );
    v.entities.values.forEach((e: any) => {
      if (e.id && prefixSet.has(e.id as string)) toRemove.push(e);
    });
    toRemove.forEach((e) => v.entities.remove(e));
    circles.value = [];
    rectangles.value = [];
    message.success('已清空所有形状');
  }

  function toggleVisibility(prefix: string, id: string) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const entity = v.entities.getById(`${prefix}_${id}`);
    if (!entity) return;
    entity.show = !entity.show;
    if (prefix === 'geoCircle') {
      circles.value = circles.value.map((c) => (c.id === id ? { ...c, visible: entity.show } : c));
    } else {
      rectangles.value = rectangles.value.map((r) => (r.id === id ? { ...r, visible: entity.show } : r));
    }
  }

  function flyTo(prefix: string, id: string) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const entity = v.entities.getById(`${prefix}_${id}`);
    if (!entity) return;
    v.flyTo(entity, { duration: 1 });
  }

  /* ==============================
   *  移动
   * ============================== */

  const isEditing = ref(false);
  const isMoving = ref(false);
  let movingPrefix: 'geoCircle' | 'geoRectangle' | null = null;
  let movingOriginal: { center: number[]; radius?: number; bounds?: number[] } | null = null;

  function startMove(prefix: 'geoCircle' | 'geoRectangle', id: string) {
    if (isMoving.value || isDrawing.value) return;
    if (prefix === 'geoCircle') {
      const circle = circles.value.find((c) => c.id === id);
      if (!circle) return;
      movingOriginal = { center: [...circle.center], radius: circle.radius };
    } else {
      const rect = rectangles.value.find((r) => r.id === id);
      if (!rect) return;
      movingOriginal = {
        center: [(rect.west + rect.east) / 2, (rect.south + rect.north) / 2],
        bounds: [rect.west, rect.south, rect.east, rect.north],
      };
    }
    movingPrefix = prefix;
    isMoving.value = true;
  }

  function applyMove(id: string, newPositions: Cartesian3[]) {
    if (!isMoving.value || !movingPrefix || !movingOriginal) return;

    if (movingPrefix === 'geoCircle' && movingOriginal.radius) {
      const newCenter = Cartographic.fromCartesian(newPositions[0]);
      const center: number[] = [toDeg(newCenter.longitude), toDeg(newCenter.latitude), newCenter.height ?? 0];
      circles.value = circles.value.map((c) => (c.id === id ? { ...c, center } : c));
      updateCircleEntity(id, { ...circles.value.find((c) => c.id === id)!, center, radius: movingOriginal.radius });
    } else if (movingPrefix === 'geoRectangle' && movingOriginal.bounds) {
      const origCenter = Cartesian3.fromDegrees(movingOriginal.center[0], movingOriginal.center[1]);
      const origCenterCarto = Cartographic.fromCartesian(origCenter);
      const newCenterCarto = Cartographic.fromCartesian(newPositions[newPositions.length - 1] || newPositions[0]);
      const dLon = toDeg(newCenterCarto.longitude - origCenterCarto.longitude);
      const dLat = toDeg(newCenterCarto.latitude - origCenterCarto.latitude);
      const b = movingOriginal.bounds;
      const rect: GeoRectangle = {
        ...rectangles.value.find((r) => r.id === id)!,
        west: b[0] + dLon,
        south: b[1] + dLat,
        east: b[2] + dLon,
        north: b[3] + dLat,
      };
      rectangles.value = rectangles.value.map((r) => (r.id === id ? rect : r));
      updateRectangleEntity(id, rect);
    }

    cancelMove();
  }

  function cancelMove() {
    isMoving.value = false;
    movingPrefix = null;
    movingOriginal = null;
  }

  return {
    circles,
    rectangles,
    isDrawing,
    activeTool,
    hasShapes,
    isEditing,
    isMoving,
    liveMeasure,
    startDraw,
    cancelDraw: cancelShapeDraw,
    removeCircle,
    removeRectangle,
    clearAll,
    toggleVisibility,
    flyTo,
    updateCircleEntity,
    updateRectangleEntity,
    startMove,
    applyMove,
    cancelMove,
  };
});
