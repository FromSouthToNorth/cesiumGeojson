/* ==============================
 * GeoPath Store — 地质路径规划测量
 * 多路径 CRUD、绘制协调、测量计算、GeoJSON 导入导出
 * ============================== */

import { ref, computed, toRaw } from 'vue';
import { defineStore } from 'pinia';
import { BoundingSphere, Cartesian3, Cartographic, Color } from 'cesium';
import { message } from 'ant-design-vue';
import { useCesiumStore } from './cesiumStore';
import { usePathDrawing } from '@/utils/cesium/usePathDrawing';
import { calcPathDistances } from '@/utils/cesium/usePathMeasure';
import { samplePathProfile } from '@/utils/cesium/usePathProfile';
import { isValidViewer, genId } from '@/utils/cesium/clipCommon';
import { useClipHistory } from '@/utils/cesium/useClipHistory';
import { usePathEditing } from '@/utils/cesium/usePathEditing';
import type { GeoPath, GeoPathType, GeoPathJSON } from '@/types/geoPath';

/** 自动分配的路径颜色 */
const PATH_COLORS = ['#FF4D4F', '#52C41A', '#1890FF', '#FAAD14', '#722ED1', '#13C2C2', '#EB2F96', '#FA541C'];

function pickColor(index: number) {
  return PATH_COLORS[index % PATH_COLORS.length];
}

/** 路径名称前缀 */
const NAME_PREFIX = '路径';

export const useGeoPathStore = defineStore('geoPath', () => {
  const cesiumStore = useCesiumStore();
  const viewer = computed(() => cesiumStore.viewer);

  /* ==============================
   *  状态
   * ============================== */

  const paths = ref<GeoPath[]>([]);
  const activePathId = ref<string | null>(null);
  /** 绘制中与 usePathDrawing 共享的顶点 ref */
  const positions = ref<Cartesian3[]>([]);
  const isDrawing = ref(false);
  const isEditing = ref(false);
  const profileLoading = ref(false);

  /** 当前选中的路径 */
  const activePath = computed(() => paths.value.find((p) => p.id === activePathId.value) ?? null);
  /** 是否有任何路径 */
  const hasPaths = computed(() => paths.value.length > 0);
  /** 展开的路径 ID 列表（UI 状态） */
  const expandedIds = ref<string[]>([]);

  /* ==============================
   *  绘制 composable
   * ============================== */

  const drawing = usePathDrawing({
    viewer,
    positions,
    color: () => activePath.value?.color ?? '#1890FF',
    onFinish: async () => {
      await finishDraw();
    },
    onCancel: () => {
      positions.value = [];
      isDrawing.value = false;
    },
    onLiveUpdate: (_segments: number[], _total: number) => {
      // 面板通过 watch positions 自行更新
    },
  });

  /* ==============================
   *  历史 + 编辑 composable
   * ============================== */

  const history = useClipHistory(positions);

  const editing = usePathEditing({
    viewer,
    positions,
    color: () => activePath.value?.color ?? '#1890FF',
    onStart: () => history.pushHistory(),
    onChange: () => {
      history.pushHistory();
      const path = activePath.value;
      if (path) path.measurements = calcPathDistances(path.positions);
    },
    onUndo: undo,
    onRedo: redo,
    onExitEdit: stopEdit,
  });

  /* ==============================
   *  路径 CRUD
   * ============================== */

  /** 创建新路径并进入绘制模式 */
  function startDraw(type: GeoPathType = 'general') {
    if (isEditing.value) return;
    const count = paths.value.length + 1;
    const path: GeoPath = {
      id: genId(),
      name: `${NAME_PREFIX} ${count}`,
      type,
      description: '',
      color: pickColor(paths.value.length),
      show: true,
      positions: [],
      measurements: { segments: [], total: 0 },
      elevationProfile: null,
      createdAt: Date.now(),
    };

    // 将 store 的 positions 指向新路径的顶点数组（共享引用）
    paths.value.push(path);
    activePathId.value = path.id;
    positions.value = path.positions;
    isDrawing.value = true;

    // 自动展开新路径
    if (!expandedIds.value.includes(path.id)) {
      expandedIds.value = [...expandedIds.value, path.id];
    }

    drawing.startDraw();
  }

  /** 完成绘制：测量距离 + 采样高程 */
  async function finishDraw() {
    const path = activePath.value;
    if (!path) {
      isDrawing.value = false;
      return;
    }

    const posCount = path.positions.length;
    isDrawing.value = false;

    if (posCount < 2) {
      // 顶点不足，移除路径
      message.warning('至少需要 2 个点才能形成路径');
      removePath(path.id);
      return;
    }

    // 计算距离
    path.measurements = calcPathDistances(path.positions);

    // 创建持久化的 Cesium 显示 entity
    createPathEntity(path);

    // 异步采样高程
    await sampleElevation(path);
    message.success(`"${path.name}" 测量完成，总距离 ${path.measurements.total.toFixed(1)} m`);
  }

  /** 采样路径高程剖面 */
  async function sampleElevation(path: GeoPath) {
    try {
      const v = toRaw(viewer.value);
      if (!isValidViewer(v)) return;
      profileLoading.value = true;
      const profile = await samplePathProfile(v.terrainProvider, path.positions);
      path.elevationProfile = profile;
    } catch (err) {
      console.error('高程采样失败:', err);
    } finally {
      profileLoading.value = false;
    }
  }

  /** 对已存在路径重新采样高程剖面 */
  async function resampleProfile(id: string) {
    const path = paths.value.find((p) => p.id === id);
    if (!path || path.positions.length < 2) return;
    await sampleElevation(path);
    if (path.elevationProfile) {
      message.success(`"${path.name}" 高程剖面采样完成`);
    }
  }

  /** 取消绘制 */
  function cancelDraw() {
    const id = activePathId.value;
    if (id) removePath(id);
    drawing.cancelDraw();
    isDrawing.value = false;
  }

  /** 选中路径 */
  function selectPath(id: string) {
    activePathId.value = id;
  }

  /** 删除路径 */
  function removePath(id: string) {
    const path = paths.value.find((p) => p.id === id);
    if (path) removePathEntity(path);

    paths.value = paths.value.filter((p) => p.id !== id);
    expandedIds.value = expandedIds.value.filter((eid) => eid !== id);

    if (activePathId.value === id) {
      const prev = paths.value[paths.value.length - 1] ?? null;
      activePathId.value = prev?.id ?? null;
    }
  }

  /** 清除所有路径 */
  function clearAll() {
    paths.value.forEach((p) => removePathEntity(p));
    paths.value = [];
    expandedIds.value = [];
    activePathId.value = null;
    positions.value = [];
  }

  /** 切换路径显隐 */
  function toggleVisibility(id: string) {
    const path = paths.value.find((p) => p.id === id);
    if (!path) return;
    path.show = !path.show;
    // 同步 Cesium entity 显隐
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const entities = v.entities.values;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.id === `geoPath_${id}`) {
        e.show = path.show;
        break;
      }
    }
  }

  /** 更新路径属性 */
  function updatePath(id: string, data: { name?: string; type?: GeoPathType; description?: string }) {
    const path = paths.value.find((p) => p.id === id);
    if (!path) return;
    if (data.name !== undefined) path.name = data.name;
    if (data.type !== undefined) path.type = data.type;
    if (data.description !== undefined) path.description = data.description;
  }

  /** 飞行到路径范围 */
  function flyToPath(id: string) {
    const path = paths.value.find((p) => p.id === id);
    if (!path || path.positions.length === 0) return;

    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    const sphere = BoundingSphere.fromPoints(path.positions);
    v.camera.flyToBoundingSphere(sphere);
  }

  /* ==============================
   *  编辑模式
   * ============================== */

  /** 进入编辑模式 */
  function startEdit(pathId?: string) {
    const id = pathId ?? activePathId.value;
    if (!id || isDrawing.value) return;
    const p = paths.value.find((p) => p.id === id);
    if (!p || p.positions.length < 2) return;

    if (activePathId.value !== id) {
      activePathId.value = id;
      positions.value = p.positions;
    }
    history.reset();
    isEditing.value = true;
    editing.startEdit();
  }

  /** 退出编辑模式，重建 entity，清除过期高程剖面 */
  function stopEdit() {
    editing.stopEdit();
    isEditing.value = false;
    const path = activePath.value;
    if (!path) return;

    // 原地更新已有 entity 的 positions，避免 remove+add 的时序问题
    const v = toRaw(viewer.value);
    if (isValidViewer(v)) {
      const entity = v.entities.getById(`geoPath_${path.id}`);
      if (entity) {
        (entity.polyline as any).positions = [...path.positions];
      }
    }
    path.elevationProfile = null; // 标记为过期
  }

  /** 撤销 */
  function undo() {
    if (!history.undo()) return;
    const path = activePath.value;
    if (path) path.measurements = calcPathDistances(path.positions);
    if (editing.isEditing.value) editing.redraw();
  }

  /** 重做 */
  function redo() {
    if (!history.redo()) return;
    const path = activePath.value;
    if (path) path.measurements = calcPathDistances(path.positions);
    if (editing.isEditing.value) editing.redraw();
  }

  /* ==============================
   *  Cesium 实体管理
   * ============================== */

  function createPathEntity(path: GeoPath) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    const color = Color.fromCssColorString(path.color);
    v.entities.add({
      id: `geoPath_${path.id}`,
      polyline: {
        positions: path.positions,
        width: 3,
        material: color,
        clampToGround: true,
      },
    });
  }

  function removePathEntity(path: GeoPath) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const entity = v.entities.getById(`geoPath_${path.id}`);
    if (entity) v.entities.remove(entity);
  }

  /* ==============================
   *  GeoJSON 导入导出
   * ============================== */

  /** 导出所有路径为 GeoJSON FeatureCollection */
  function exportToGeoJson(): GeoPathJSON {
    return {
      type: 'FeatureCollection',
      features: paths.value.map((p) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: p.positions.map((pos) => {
            const carto = Cartographic.fromCartesian(pos);
            return [toDeg(carto.longitude), toDeg(carto.latitude), carto.height ?? 0];
          }),
        },
        properties: {
          id: p.id,
          name: p.name,
          type: p.type,
          description: p.description,
          color: p.color,
          totalDistance: p.measurements.total,
          createdAt: p.createdAt,
        },
      })),
    };
  }

  /** 下载 GeoJSON 文件 */
  function downloadGeoJson() {
    const data = exportToGeoJson();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `地质路径_${new Date().toISOString().slice(0, 10)}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('导出成功');
  }

  /** 从 GeoJSON 导入路径 */
  function importFromGeoJson(data: GeoPathJSON) {
    if (!data?.features?.length) {
      message.warning('GeoJSON 中没有要素数据');
      return;
    }

    data.features.forEach((feature) => {
      const coords = feature.geometry.coordinates;
      if (coords.length < 2) return;

      const pathPositions = coords.map(
        ([lng, lat, h]) => Cartesian3.fromDegrees(lng, lat, h ?? 0),
      );

      const path: GeoPath = {
        id: genId(),
        name: feature.properties?.name ?? `${NAME_PREFIX} ${paths.value.length + 1}`,
        type: feature.properties?.type ?? 'general',
        description: feature.properties?.description ?? '',
        color: pickColor(paths.value.length),
        show: true,
        positions: pathPositions,
        measurements: calcPathDistances(pathPositions),
        elevationProfile: null,
        createdAt: Date.now(),
      };

      paths.value.push(path);
      activePathId.value = path.id;
      positions.value = path.positions;
      createPathEntity(path);

      if (!expandedIds.value.includes(path.id)) {
        expandedIds.value = [...expandedIds.value, path.id];
      }
    });

    message.success(`成功导入 ${data.features.length} 条路径`);
  }

  return {
    // state
    paths,
    positions,
    activePathId,
    isDrawing,
    profileLoading,
    expandedIds,
    // computed
    activePath,
    hasPaths,
    // path CRUD
    startDraw,
    cancelDraw,
    selectPath,
    removePath,
    clearAll,
    toggleVisibility,
    updatePath,
    flyToPath,
    // editing
    isEditing,
    startEdit,
    stopEdit,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    // profile
    resampleProfile,
    // export
    downloadGeoJson,
    importFromGeoJson,
  };
});

function toDeg(rad: number) {
  return (rad * 180) / Math.PI;
}
