/* ==============================
 * GeoPath Store — 地质路径规划测量
 * 多路径 CRUD、绘制协调、测量计算、GeoJSON 导入导出
 * ============================== */

import { ref, computed, toRaw } from 'vue';
import { defineStore } from 'pinia';
import { BoundingSphere, Cartesian3, Cartographic, Color, EllipsoidGeodesic } from 'cesium';
import { message } from 'ant-design-vue';
import { useCesiumStore } from './cesiumStore';
import { usePathDrawing } from '@/utils/cesium/path/usePathDrawing';
import { useSnapping } from '@/utils/cesium/shared/useSnapping';
import type { SnapSource } from '@/utils/cesium/shared/useSnapping';
import { calcPathDistances } from '@/utils/cesium/path/usePathMeasure';
import { samplePathProfile } from '@/utils/cesium/path/usePathProfile';
import { isValidViewer, genId, toDeg } from '@/utils/cesium/shared/common';
import { useClipHistory } from '@/utils/cesium/terrain-clip/useClipHistory';
import { usePathEditing } from '@/utils/cesium/path/usePathEditing';
import { usePathPlayback } from '@/utils/cesium/path/usePathPlayback';
import type { GeoPath, GeoPathType, GeoPathJSON } from '@/types/geoPath';
import { useGeoPolygonStore } from './geoPolygonStore';

/** 自动分配的路径颜色 */
const PATH_COLORS = ['#FF4D4F', '#52C41A', '#1890FF', '#FAAD14', '#722ED1', '#13C2C2', '#EB2F96', '#FA541C'];

function pickColor(index: number) {
  return PATH_COLORS[index % PATH_COLORS.length];
}

/** 根据高程映射颜色（绿→黄→红） */
function elevationToColor(elev: number, minE: number, maxE: number): Color {
  const range = Math.max(maxE - minE, 1);
  const t = (elev - minE) / range;
  if (t < 0.5) {
    const t2 = t / 0.5;
    return new Color(t2, 1, 0);
  } else {
    const t2 = (t - 0.5) / 0.5;
    return new Color(1, 1 - t2, 0);
  }
}

/** 沿路径在指定累计距离处插值出 Cartesian3 位置 */
function interpolatePositionsAtDistances(
  positions: Cartesian3[],
  targetDistances: number[],
  segmentDistances: number[],
  _totalDistance: number,
): Cartesian3[] {
  const cartos = positions.map((p) => Cartographic.fromCartesian(p));
  const result: Cartesian3[] = [];
  let dAccum = 0;
  let segIdx = 0;

  for (const td of targetDistances) {
    while (segIdx < segmentDistances.length - 1 && dAccum + segmentDistances[segIdx] < td) {
      dAccum += segmentDistances[segIdx];
      segIdx++;
    }
    const segD = segmentDistances[segIdx] || 1;
    const frac = Math.max(0, Math.min(1, (td - dAccum) / segD));
    const geodesic = new EllipsoidGeodesic(cartos[segIdx], cartos[segIdx + 1]);
    const interp = geodesic.interpolateUsingFraction(frac);
    result.push(Cartesian3.fromRadians(interp.longitude, interp.latitude, interp.height));
  }
  return result;
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
  const snappingEnabled = ref(true);

  /** 当前选中的路径 */
  const activePath = computed(() => paths.value.find((p) => p.id === activePathId.value) ?? null);
  /** 是否有任何路径 */
  const hasPaths = computed(() => paths.value.length > 0);
  /** 展开的路径 ID 列表（UI 状态） */
  const expandedIds = ref<string[]>([]);

  /** 当前选中路径的顶点坐标数据 */
  const vertexData = computed(() => {
    const path = activePath.value;
    if (!path) return [];
    return path.positions.map((pos) => {
      const carto = Cartographic.fromCartesian(pos);
      return {
        lng: toDeg(carto.longitude),
        lat: toDeg(carto.latitude),
        height: carto.height ?? 0,
      };
    });
  });

  /* ==============================
   *  绘制 composable + 吸附
   * ============================== */

  const pathSnapping = useSnapping({
    viewer,
    enabled: snappingEnabled,
    pixelThreshold: 12,
    collectTargets: () => {
      const targets: SnapSource[] = [];
      // 收集所有已有路径的顶点和边中点
      paths.value.forEach((p) => {
        const pos = p.positions;
        // 顶点
        pos.forEach((pt) => targets.push({ position: pt, sourceType: 'path' }));
        // 边中点（开放路径：n-1 条边）
        for (let i = 0; i < pos.length - 1; i++) {
          const mid = Cartesian3.midpoint(pos[i], pos[i + 1], new Cartesian3());
          targets.push({ position: mid, sourceType: 'path', isMidpoint: true });
        }
      });
      // 跨 store 收集多边形顶点和边中点
      try {
        const polyStore = useGeoPolygonStore();
        polyStore.polygons.forEach((p) => {
          const pos = p.positions;
          const n = pos.length;
          // 顶点
          pos.forEach((pt) => targets.push({ position: pt, sourceType: 'polygon' }));
          // 边中点（闭合多边形：n 条边）
          for (let i = 0; i < n; i++) {
            const next = (i + 1) % n;
            const mid = Cartesian3.midpoint(pos[i], pos[next], new Cartesian3());
            targets.push({ position: mid, sourceType: 'polygon', isMidpoint: true });
          }
        });
      } catch {
        // geoPolygonStore 可能尚未初始化
      }
      return targets;
    },
  });

  const drawing = usePathDrawing({
    viewer,
    positions,
    color: () => activePath.value?.color ?? '#1890FF',
    snapping: {
      findSnapTarget: pathSnapping.findSnapTarget,
      setup: pathSnapping.setup,
      teardown: pathSnapping.teardown,
      invalidateCache: pathSnapping.invalidateCache,
    },
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
   *  轨迹播放
   * ============================== */

  const playback = usePathPlayback({ viewer });

  /* ==============================
   *  路径 CRUD
   * ============================== */

  /** 创建新路径并进入绘制模式 */
  function startDraw(type: GeoPathType = 'general') {
    if (isEditing.value || isMoving.value) return;
    if (playback.isPlaying.value) playback.stopPlayback();
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
      // 重建 entity 以使用新剖面数据着色
      if (profile && !isEditing.value) {
        removePathEntities(path.id);
        createPathEntity(path);
      }
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

  /** 删除路径（编辑中先退出编辑；播放中先停止） */
  function removePath(id: string) {
    if (playback.isPlaying.value) playback.stopPlayback();
    if (isEditing.value && activePathId.value === id) {
      editing.stopEdit();
      isEditing.value = false;
    }
    removePathEntities(id);

    paths.value = paths.value.filter((p) => p.id !== id);
    expandedIds.value = expandedIds.value.filter((eid) => eid !== id);

    if (activePathId.value === id) {
      const prev = paths.value[paths.value.length - 1] ?? null;
      activePathId.value = prev?.id ?? null;
    }
  }

  /** 清除所有路径（编辑中先退出编辑；播放中先停止） */
  function clearAll() {
    if (playback.isPlaying.value) playback.stopPlayback();
    if (isEditing.value) {
      editing.stopEdit();
      isEditing.value = false;
    }
    paths.value.forEach((p) => removePathEntities(p.id));
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
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const ids = findPathEntityIds(id);
    ids.forEach((eid) => {
      const e = v.entities.getById(eid);
      if (e) e.show = path.show;
    });
  }

  /** 批量切换所有路径显隐 */
  function toggleAllVisibility() {
    const targetShow = !paths.value.every((p) => p.show);
    paths.value.forEach((p) => {
      if (p.show !== targetShow) {
        toggleVisibility(p.id);
      }
    });
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
    if (!id || isDrawing.value || isMoving.value) return;
    if (playback.isPlaying.value) playback.stopPlayback();
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

    removePathEntities(path.id);
    createPathEntity(path); // 重建（无剖面时单色）
    path.elevationProfile = null; // 标记为过期
  }

  /** 撤销（编辑/移动后均重建实体） */
  function undo() {
    if (!history.undo()) return;
    const path = activePath.value;
    if (path) {
      path.measurements = calcPathDistances(path.positions);
      if (!isEditing.value) {
        removePathEntities(path.id);
        createPathEntity(path);
      }
    }
    if (editing.isEditing.value) editing.redraw();
  }

  /** 重做（编辑/移动后均重建实体） */
  function redo() {
    if (!history.redo()) return;
    const path = activePath.value;
    if (path) {
      path.measurements = calcPathDistances(path.positions);
      if (!isEditing.value) {
        removePathEntities(path.id);
        createPathEntity(path);
      }
    }
    if (editing.isEditing.value) editing.redraw();
  }

  /* ==============================
   *  移动（平移整个路径）
   * ============================== */

  const isMoving = ref(false);

  function startMove(id: string) {
    if (isEditing.value || isDrawing.value) return;
    const path = paths.value.find((p) => p.id === id);
    if (!path || path.positions.length < 2) return;
    if (playback.isPlaying.value) playback.stopPlayback();
    activePathId.value = id;
    history.reset(); // 清空编辑历史，移动后撤回只回退移动操作
    positions.value = path.positions;
    isMoving.value = true;
  }

  function cancelMove() {
    isMoving.value = false;
  }

  /** 应用移动后的新顶点位置（支持撤销/重做） */
  function applyMovePositions(id: string, newPositions: Cartesian3[]) {
    const path = paths.value.find((p) => p.id === id);
    if (!path) return;

    positions.value = path.positions;
    history.pushHistory(); // 快照移动前状态

    path.positions = newPositions;
    positions.value = newPositions;
    path.measurements = calcPathDistances(newPositions);
    path.elevationProfile = null;

    // 重建 Cesium entity
    removePathEntities(id);
    createPathEntity(path);

    history.pushHistory(); // 快照移动后状态（支持重做）

    isMoving.value = false;
  }

  /* ==============================
   *  Cesium 实体管理
   * ============================== */

  function findPathEntityIds(id: string): string[] {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return [];
    const prefix = `geoPath_${id}`;
    const ids: string[] = [];
    v.entities.values.forEach((e: any) => {
      if (e.id && (e.id as string).startsWith(prefix)) ids.push(e.id as string);
    });
    return ids;
  }

  function removePathEntities(id: string) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const ids = findPathEntityIds(id);
    ids.forEach((eid) => {
      const e = v.entities.getById(eid);
      if (e) v.entities.remove(e);
    });
  }

  function createPathEntity(path: GeoPath) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    // 如果没有高程剖面，使用单色 polyline（兼容旧数据）
    if (!path.elevationProfile || path.elevationProfile.elevations.length < 2) {
      v.entities.add({
        id: `geoPath_${path.id}_main`,
        polyline: {
          positions: path.positions,
          width: 3,
          material: Color.fromCssColorString(path.color),
          clampToGround: true,
        },
      });
      return;
    }

    // 有高程剖面：分段着色
    const { distances, elevations } = path.elevationProfile;
    const { minElevation, maxElevation } = path.elevationProfile;

    // 计算原始路径的每段距离
    const cartos = path.positions.map((p) => Cartographic.fromCartesian(p));
    const segDists: number[] = [];
    for (let i = 0; i < cartos.length - 1; i++) {
      segDists.push(new EllipsoidGeodesic(cartos[i], cartos[i + 1]).surfaceDistance);
    }
    const pathTotal = segDists.reduce((a, b) => a + b, 0);

    // 为每个剖面采样点插值出地图位置
    const profilePositions = interpolatePositionsAtDistances(path.positions, distances, segDists, pathTotal);

    // 批量合并每 5 个采样点为一段，减少 entity 数量
    const batchSize = 5;
    const lineWidth = 5;
    for (let i = 0; i < profilePositions.length - 1 && i < elevations.length - 1; i += batchSize) {
      const end = Math.min(i + batchSize + 1, profilePositions.length);
      const batchPos = profilePositions.slice(i, end);
      const avgElev =
        elevations.slice(i, Math.min(i + batchSize, elevations.length - 1) + 1).reduce((a, b) => a + b, 0) / (end - i);
      const segColor = elevationToColor(avgElev, minElevation, maxElevation);

      v.entities.add({
        id: `geoPath_${path.id}_seg_${Math.floor(i / batchSize)}`,
        polyline: {
          positions: batchPos,
          width: lineWidth,
          material: segColor,
          clampToGround: true,
        },
      });
    }
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

      const pathPositions = coords.map(([lng, lat, h]) => Cartesian3.fromDegrees(lng, lat, h ?? 0));

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
    snappingEnabled,
    isSnapping: pathSnapping.isSnapping,
    // computed
    activePath,
    hasPaths,
    vertexData,
    // path CRUD
    startDraw,
    cancelDraw,
    selectPath,
    removePath,
    clearAll,
    toggleVisibility,
    toggleAllVisibility,
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
    // moving
    isMoving,
    startMove,
    cancelMove,
    applyMovePositions,
    // profile
    resampleProfile,
    // export
    downloadGeoJson,
    importFromGeoJson,
    // playback
    playbackIsPlaying: playback.isPlaying,
    playbackIsPaused: playback.isPaused,
    playbackSpeed: playback.speed,
    playbackFollowCamera: playback.followCamera,
    playbackProgress: playback.progress,
    playbackDistance: playback.currentDistance,
    playbackDuration: playback.currentDuration,
    playbackEstimatedDuration: playback.estimatedDuration,
    startPlayback: playback.startPlayback,
    pausePlayback: playback.pausePlayback,
    resumePlayback: playback.resumePlayback,
    stopPlayback: playback.stopPlayback,
    setPlaybackSpeed: playback.setSpeed,
    seekPlayback: playback.seekTo,
    togglePlaybackFollowCamera: playback.toggleFollowCamera,
  };
});
