/* ==============================
 * GeoPolygon Store — 多边形地质勘测
 * 多边形 CRUD、绘制协调、面积测量、GeoJSON 导出
 * ============================== */

import { ref, computed, toRaw } from 'vue';
import { defineStore } from 'pinia';
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  ClippingPolygon,
  ClippingPolygonCollection,
  Color,
  HorizontalOrigin,
  VerticalOrigin,
  sampleTerrain,
} from 'cesium';
import { message } from 'ant-design-vue';
import { useCesiumStore } from './cesiumStore';
import { usePolygonDrawing, calcPolygonMeasure } from '@/utils/cesium/usePolygonDrawing';
import { isValidViewer, genId } from '@/utils/cesium/clipCommon';
import { useClipHistory } from '@/utils/cesium/useClipHistory';
import { usePolygonEditing } from '@/utils/cesium/usePolygonEditing';
import type { GeoPolygon, GeoPolygonJSON, SlopeAnalysisResult } from '@/types/geoPolygon';
import { analyzePolygonSlope } from '@/utils/cesium/usePolygonSlope';

/** 自动分配的多边形颜色 */
const POLYGON_COLORS = ['#FF4D4F', '#52C41A', '#1890FF', '#FAAD14', '#722ED1', '#13C2C2', '#EB2F96', '#FA541C'];

function pickColor(index: number) {
  return POLYGON_COLORS[index % POLYGON_COLORS.length];
}

const NAME_PREFIX = '勘测区域';

export const useGeoPolygonStore = defineStore('geoPolygon', () => {
  const cesiumStore = useCesiumStore();
  const viewer = computed(() => cesiumStore.viewer);

  /* ==============================
   *  状态
   * ============================== */

  const polygons = ref<GeoPolygon[]>([]);
  const activePolygonId = ref<string | null>(null);
  const positions = ref<import('cesium').Cartesian3[]>([]);
  const isDrawing = ref(false);
  const isEditing = ref(false);

  const activePolygon = computed(() => polygons.value.find((p) => p.id === activePolygonId.value) ?? null);
  const hasPolygons = computed(() => polygons.value.length > 0);

  /** 多边形汇总统计 */
  const polygonStats = computed(() => {
    const list = polygons.value;
    const count = list.length;
    if (count === 0) return null;
    const totalArea = list.reduce((s, p) => s + p.measurements.area, 0);
    const areas = list.map((p) => p.measurements.area);
    return {
      count,
      totalArea,
      maxArea: Math.max(...areas),
      minArea: Math.min(...areas),
      avgArea: totalArea / count,
    };
  });

  /** 当前选中多边形的顶点坐标数据 */
  const vertexData = computed(() => {
    const poly = activePolygon.value;
    if (!poly) return [];
    return poly.positions.map((pos, i) => {
      const carto = Cartographic.fromCartesian(pos);
      return {
        lng: toDeg(carto.longitude),
        lat: toDeg(carto.latitude),
        height: carto.height ?? 0,
        elevation: poly.vertexElevations?.[i] ?? null,
      };
    });
  });

  /** 标注显隐 */
  const showLabels = ref(true);

  /** 坡度分析 */
  const slopeLoading = ref(false);
  const slopeResult = ref<SlopeAnalysisResult | null>(null);
  const showSlopeGrid = ref(false);

  /** 裁切反选 */
  const clippingInverse = ref(false);

  /* ==============================
   *  绘制 composable
   * ============================== */

  const drawing = usePolygonDrawing({
    viewer,
    positions,
    onFinish: async (result) => {
      await finishDraw(result);
    },
    onCancel: () => {
      const id = activePolygonId.value;
      if (id) removePolygon(id);
      positions.value = [];
      isDrawing.value = false;
    },
    onLiveUpdate: () => {
      // 面板通过 watch positions 自行更新
    },
  });

  /* ==============================
   *  历史 + 编辑 composable
   * ============================== */

  const history = useClipHistory(positions);

  const editing = usePolygonEditing({
    viewer,
    positions,
    color: () => activePolygon.value?.color ?? '#1890FF',
    onStart: () => history.pushHistory(),
    onChange: () => {
      history.pushHistory();
      const poly = activePolygon.value;
      if (poly) {
        poly.measurements = calcPolygonMeasure(poly.positions);
        poly.vertexElevations = undefined; // 顶点已变，清空海拔
      }
    },
    onUndo: undo,
    onRedo: redo,
    onExitEdit: stopEdit,
  });

  /* ==============================
   *  多边形 CRUD
   * ============================== */

  /** 创建新多边形并进入绘制模式 */
  function startDraw() {
    if (isEditing.value) return;
    const count = polygons.value.length + 1;
    const polygon: GeoPolygon = {
      id: genId(),
      name: `${NAME_PREFIX} ${count}`,
      description: '',
      color: pickColor(polygons.value.length),
      show: true,
      positions: [],
      measurements: { segments: [], perimeter: 0, area: 0 },
      createdAt: Date.now(),
      clipping: false,
    };

    polygons.value.push(polygon);
    activePolygonId.value = polygon.id;
    positions.value = polygon.positions;
    isDrawing.value = true;

    drawing.startDraw();
  }

  /** 完成绘制 */
  async function finishDraw(result: { segments: number[]; perimeter: number; area: number }) {
    const polygon = activePolygon.value;
    if (!polygon) {
      isDrawing.value = false;
      return;
    }

    const posCount = polygon.positions.length;
    isDrawing.value = false;

    if (posCount < 3) {
      message.warning('至少需要 3 个点才能形成多边形');
      removePolygon(polygon.id);
      return;
    }

    polygon.measurements = result;
    createPolygonEntity(polygon);
    // 异步采样顶点地形高程
    sampleVertexElevation(polygon);
    message.success(`"${polygon.name}" 测量完成，面积 ${formatArea(result.area)}，周长 ${formatDist(result.perimeter)}`);
  }

  /** 采样多边形各顶点的地形高程 */
  async function sampleVertexElevation(polygon: GeoPolygon) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const cartos = polygon.positions.map((p) => Cartographic.fromCartesian(p));
    try {
      await sampleTerrain(v.terrainProvider, 11, cartos);
      polygon.vertexElevations = cartos.map((c) => c.height ?? 0);
    } catch (err) {
      console.error('顶点高程采样失败:', err);
    }
  }

  /** 取消绘制 */
  function cancelDraw() {
    const id = activePolygonId.value;
    if (id) removePolygon(id);
    drawing.cancelDraw();
    isDrawing.value = false;
  }

  /** 选中多边形 */
  function selectPolygon(id: string) {
    activePolygonId.value = id;
  }

  /** 删除多边形（编辑中先退出编辑） */
  function removePolygon(id: string) {
    if (isEditing.value && activePolygonId.value === id) {
      editing.stopEdit();
      isEditing.value = false;
    }
    const polygon = polygons.value.find((p) => p.id === id);
    if (polygon) removePolygonEntity(polygon);
    removeSlopeGridEntities(id);
    polygons.value = polygons.value.filter((p) => p.id !== id);
    syncPolygonClipping();

    if (activePolygonId.value === id) {
      const prev = polygons.value[polygons.value.length - 1] ?? null;
      activePolygonId.value = prev?.id ?? null;
    }
  }

  /** 清除所有多边形（编辑中先退出编辑） */
  function clearAll() {
    if (isEditing.value) {
      editing.stopEdit();
      isEditing.value = false;
    }
    polygons.value.forEach((p) => removePolygonEntity(p));
    polygons.value = [];
    activePolygonId.value = null;
    positions.value = [];
    syncPolygonClipping();
  }

  /** 切换多边形显隐 */
  function toggleVisibility(id: string) {
    const polygon = polygons.value.find((p) => p.id === id);
    if (!polygon) return;
    polygon.show = !polygon.show;
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const entities = v.entities.values;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.id === `geoPolygon_${id}`) {
        e.show = polygon.show;
        break;
      }
    }
  }

  /** 更新多边形名称 */
  function updatePolygonName(id: string, name: string) {
    const polygon = polygons.value.find((p) => p.id === id);
    if (!polygon) return;
    polygon.name = name;
  }

  /** 飞行到多边形范围 */
  function flyToPolygon(id: string) {
    const polygon = polygons.value.find((p) => p.id === id);
    if (!polygon || polygon.positions.length === 0) return;

    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    const sphere = BoundingSphere.fromPoints(polygon.positions);
    v.camera.flyToBoundingSphere(sphere);
  }

  /* ==============================
   *  地形裁切
   * ============================== */

  /** 切换多边形裁切开关 */
  function toggleClipping(id: string) {
    const poly = polygons.value.find((p) => p.id === id);
    if (!poly || poly.positions.length < 3) {
      message.warning('多边形至少需要 3 个顶点才能裁切');
      return;
    }
    poly.clipping = !poly.clipping;
    syncPolygonClipping();
    message.success(poly.clipping ? `"${poly.name}" 已启用裁切` : `"${poly.name}" 已关闭裁切`);
  }

  /** 将所有开启了裁切的多边形同步到 globe */
  function syncPolygonClipping() {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    const clippingPolys = polygons.value.filter(
      (p) => p.clipping && p.positions.length >= 3,
    );

    if (clippingPolys.length === 0) {
      v.scene.globe.clippingPolygons = new ClippingPolygonCollection();
      v.scene.globe.depthTestAgainstTerrain = false;
      return;
    }

    v.scene.globe.depthTestAgainstTerrain = true;
    const polyGeometries = clippingPolys.map((p) => new ClippingPolygon({ positions: p.positions }));
    v.scene.globe.clippingPolygons = new ClippingPolygonCollection({
      polygons: polyGeometries,
      inverse: clippingInverse.value,
    });
  }

  /** 切换裁切反选 */
  function toggleClippingInverse() {
    clippingInverse.value = !clippingInverse.value;
    syncPolygonClipping();
  }

  /* ==============================
   *  坡度分析
   * ============================== */

  function clearSlopeAnalysis() {
    const id = activePolygonId.value;
    if (id) removeSlopeGridEntities(id);
    slopeResult.value = null;
    slopeLoading.value = false;
    showSlopeGrid.value = false;
  }

  async function analyzeSlope(id?: string) {
    const polyId = id ?? activePolygonId.value;
    if (!polyId) return;
    const poly = polygons.value.find((p) => p.id === polyId);
    if (!poly || poly.positions.length < 3) return;

    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    slopeLoading.value = true;
    slopeResult.value = null;

    try {
      const cartos = poly.positions.map((p) => Cartographic.fromCartesian(p));
      const result = await analyzePolygonSlope(v.terrainProvider, cartos);
      console.log('result: ', result);
      slopeResult.value = result;
      if (result) {
        removeSlopeGridEntities(polyId);
        createSlopeGridEntities(polyId);
        showSlopeGrid.value = true;
      } else {
        message.warning('坡度分析失败，采样点不足');
      }
    } catch (err) {
      console.error('坡度分析出错:', err);
      message.error('坡度分析失败');
    } finally {
      slopeLoading.value = false;
    }
  }

  /* ==============================
   *  编辑模式
   * ============================== */

  /** 进入编辑模式 */
  function startEdit(polygonId?: string) {
    const id = polygonId ?? activePolygonId.value;
    if (!id || isDrawing.value) return;
    const poly = polygons.value.find((p) => p.id === id);
    if (!poly || poly.positions.length < 3) return;
    clearSlopeAnalysis();

    if (activePolygonId.value !== id) {
      activePolygonId.value = id;
      positions.value = poly.positions;
    }
    history.reset();
    isEditing.value = true;
    editing.startEdit();
  }

  /** 退出编辑模式，更新实体，重新采样海拔 */
  function stopEdit() {
    editing.stopEdit();
    isEditing.value = false;
    const poly = activePolygon.value;
    if (!poly) return;

    // 原地更新已有 entity 的 hierarchy，避免 remove+add 的时序问题
    const v = toRaw(viewer.value);
    if (isValidViewer(v)) {
      const entity = v.entities.getById(`geoPolygon_${poly.id}`);
      if (entity) {
        (entity.polygon as any).hierarchy = [...poly.positions];
        (entity.position as any) = BoundingSphere.fromPoints(poly.positions).center;
        if (entity.label) (entity.label as any).text = `${poly.name}\n${formatArea(poly.measurements.area)}`;
      }
    }

    // 重新采样顶点海拔（编辑后顶点已变）
    sampleVertexElevation(poly);
  }

  /** 撤销 */
  function undo() {
    if (!history.undo()) return;
    const poly = activePolygon.value;
    if (poly) poly.measurements = calcPolygonMeasure(poly.positions);
    if (editing.isEditing.value) editing.redraw();
  }

  /** 重做 */
  function redo() {
    if (!history.redo()) return;
    const poly = activePolygon.value;
    if (poly) poly.measurements = calcPolygonMeasure(poly.positions);
    if (editing.isEditing.value) editing.redraw();
  }

  /* ==============================
   *  Cesium 实体管理
   * ============================== */

  function createPolygonEntity(polygon: GeoPolygon) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    const color = Color.fromCssColorString(polygon.color);
    const center = BoundingSphere.fromPoints(polygon.positions).center;

    v.entities.add({
      id: `geoPolygon_${polygon.id}`,
      position: center,
      polygon: {
        hierarchy: polygon.positions,
        material: color.withAlpha(0.3),
        outline: true,
        outlineColor: color,
        outlineWidth: 2,
      },
      label: {
        text: `${polygon.name}\n${formatArea(polygon.measurements.area)}`,
        font: '14px sans-serif',
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: new Color(0, 0, 0, 0.6),
        pixelOffset: new Cartesian2(0, -20),
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.TOP,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  function removePolygonEntity(polygon: GeoPolygon) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const entity = v.entities.getById(`geoPolygon_${polygon.id}`);
    if (entity) v.entities.remove(entity);
  }

  /* ==============================
   *  坡度网格可视化
   * ============================== */

  function removeSlopeGridEntities(id: string) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const prefix = `geoPolygon_${id}_slope_`;
    const toRemove: any[] = [];
    v.entities.values.forEach((e: any) => {
      if (e.id && (e.id as string).startsWith(prefix)) toRemove.push(e);
    });
    toRemove.forEach((e) => v.entities.remove(e));
  }

  function createSlopeGridEntities(id: string) {
    if (!slopeResult.value?.gridPoints.length) return;
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    removeSlopeGridEntities(id);

    const colorMap: Record<string, Color> = {
      gentle: Color.fromCssColorString('#52C41A'),
      moderate: Color.fromCssColorString('#FAAD14'),
      steep: Color.fromCssColorString('#FF4D4F'),
    };

    slopeResult.value.gridPoints.forEach((pt, i) => {
      const pos = Cartesian3.fromRadians(pt.lon, pt.lat, pt.height);
      v.entities.add({
        id: `geoPolygon_${id}_slope_${i}`,
        position: pos,
        point: {
          pixelSize: 6,
          color: colorMap[pt.category].withAlpha(0.85),
          outlineColor: Color.WHITE.withAlpha(0.3),
          outlineWidth: 1,
        },
      });
    });
  }

  function toggleSlopeGrid() {
    showSlopeGrid.value = !showSlopeGrid.value;
    const polyId = activePolygonId.value;
    if (!polyId) return;
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const prefix = `geoPolygon_${polyId}_slope_`;
    v.entities.values.forEach((e: any) => {
      if (e.id && (e.id as string).startsWith(prefix)) {
        e.show = showSlopeGrid.value;
      }
    });
  }

  /* ==============================
   *  GeoJSON 导出
   * ============================== */

  function exportToGeoJson(): GeoPolygonJSON {
    return {
      type: 'FeatureCollection',
      features: polygons.value.map((p) => {
        const coords = p.positions.map((pos) => {
          const carto = Cartographic.fromCartesian(pos);
          return [toDeg(carto.longitude), toDeg(carto.latitude), carto.height ?? 0];
        });
        // GeoJSON Polygon 要求首尾闭合
        if (coords.length > 0) coords.push([...coords[0]]);
        return {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [coords],
          },
          properties: {
            id: p.id,
            name: p.name,
            description: p.description || undefined,
            color: p.color,
            area: p.measurements.area,
            perimeter: p.measurements.perimeter,
            vertexElevations: p.vertexElevations?.length ? p.vertexElevations : undefined,
            clipping: p.clipping ?? false,
            createdAt: p.createdAt,
          },
        };
      }),
    };
  }

  /** 切换地图标注显隐 */
  function toggleLabels() {
    showLabels.value = !showLabels.value;
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    polygons.value.forEach((poly) => {
      const entity = v.entities.getById(`geoPolygon_${poly.id}`);
      if (entity?.label) (entity.label as any).show = showLabels.value;
    });
  }

  /** 导出当前多边形顶点坐标为 CSV */
  function exportVerticesCsv() {
    const poly = activePolygon.value;
    if (!poly) { message.warning('请先选中一个多边形'); return; }

    const rows = [['#', '经度', '纬度', '椭球高', '海拔'].join(',')];
    poly.positions.forEach((pos, i) => {
      const carto = Cartographic.fromCartesian(pos);
      const lng = toDeg(carto.longitude).toFixed(6);
      const lat = toDeg(carto.latitude).toFixed(6);
      const h = (carto.height ?? 0).toFixed(2);
      const elev = poly.vertexElevations?.[i]?.toFixed(2) ?? '-';
      rows.push([i + 1, lng, lat, h, elev].join(','));
    });

    const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${poly.name}_顶点坐标.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('顶点坐标导出成功');
  }

  /** 下载 GeoJSON 文件 */
  function downloadGeoJson() {
    const data = exportToGeoJson();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `多边形勘测_${new Date().toISOString().slice(0, 10)}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('导出成功');
  }

  /** 从 GeoJSON 导入多边形 */
  function importFromGeoJson(data: GeoPolygonJSON) {
    if (!data?.features?.length) {
      message.warning('GeoJSON 中没有要素数据');
      return;
    }

    data.features.forEach((feature) => {
      const ring = feature.geometry.coordinates[0];
      if (ring.length < 4) return; // 至少 3 个顶点（首尾闭合需 4 个点）
      // 跳过闭合点（首尾相同）
      const polyPositions = ring.slice(0, -1).map(
        ([lng, lat, h]) => Cartesian3.fromDegrees(lng, lat, h ?? 0),
      );

      if (polyPositions.length < 3) return;

      const polygon: GeoPolygon = {
        id: genId(),
        name: feature.properties?.name ?? `${NAME_PREFIX} ${polygons.value.length + 1}`,
        description: feature.properties?.description ?? '',
        color: pickColor(polygons.value.length),
        show: true,
        positions: polyPositions,
        measurements: calcPolygonMeasure(polyPositions),
        vertexElevations: feature.properties?.vertexElevations,
        createdAt: Date.now(),
        clipping: feature.properties?.clipping ?? false,
      };

      polygons.value.push(polygon);
      activePolygonId.value = polygon.id;
      positions.value = polygon.positions;
      createPolygonEntity(polygon);
    });

    message.success(`成功导入 ${data.features.length} 个多边形`);
  }

  return {
    // state
    polygons,
    activePolygonId,
    positions,
    isDrawing,
    showLabels,
    // computed
    activePolygon,
    hasPolygons,
    polygonStats,
    vertexData,
    // CRUD
    startDraw,
    cancelDraw,
    selectPolygon,
    removePolygon,
    clearAll,
    toggleVisibility,
    updatePolygonName,
    flyToPolygon,
    // editing
    isEditing,
    startEdit,
    stopEdit,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    // clipping
    toggleClipping,
    clippingInverse,
    toggleClippingInverse,
    // slope analysis
    slopeLoading,
    slopeResult,
    showSlopeGrid,
    analyzeSlope,
    clearSlopeAnalysis,
    toggleSlopeGrid,
    // display
    toggleLabels,
    exportVerticesCsv,
    // export
    downloadGeoJson,
    importFromGeoJson,
  };
});

function toDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

/** 格式化面积 */
export function formatArea(area: number): string {
  if (area >= 1_000_000) return `${(area / 1_000_000).toFixed(2)} km²`;
  if (area >= 10_000) return `${(area / 10_000).toFixed(2)} ha`;
  return `${area.toFixed(2)} m²`;
}

/** 格式化距离 */
export function formatDist(dist: number): string {
  if (dist >= 1000) return `${(dist / 1000).toFixed(3)} km`;
  return `${dist.toFixed(1)} m`;
}
