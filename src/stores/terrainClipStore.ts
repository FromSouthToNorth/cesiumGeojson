import { ref, computed, watch, toRaw } from 'vue';
import { defineStore } from 'pinia';
import {
  Cartesian3,
  Cartographic,
  Rectangle,
  Math as CesiumMath,
  ClippingPolygon,
  ClippingPolygonCollection,
} from 'cesium';
import { useCesiumStore } from './cesiumStore';
import { isValidViewer, genId } from '@/utils/cesium/shared/common';
import { useClipDrawing } from '@/utils/cesium/terrain-clip/useClipDrawing';
import { useClipEditing } from '@/utils/cesium/terrain-clip/useClipEditing';
import { useClipHistory } from '@/utils/cesium/terrain-clip/useClipHistory';
import { useClipPersistence } from '@/utils/cesium/terrain-clip/useClipPersistence';
import type { ClipRegion } from '@/utils/cesium/shared/common';

/**
 * 地形裁切 Store
 *
 * 职责：作为协调器，组合 4 个 composable，暴露统一 API 给 UI 组件。
 *
 * 架构：
 *   terrainClipStore（本例）→ 协调
 *     ├── useClipDrawing      — 绘制模式交互
 *     ├── useClipEditing      — 编辑模式交互
 *     ├── useClipHistory      — 撤销/重做历史栈
 *     └── useClipPersistence  — localStorage 持久化
 *
 * 核心数据流：
 *   regions[i].positions 与 positions ref 共享引用（通过赋值 `positions.value = region.positions`）
 *   → 绘制/编辑/历史 均操作同一 positions ref
 *   → 变更自动反映到对应 region 上
 *   → 调用 syncGlobeClipping() 同步到 Cesium globe
 */
export const useTerrainClipStore = defineStore('terrainClip', () => {
  const cesiumStore = useCesiumStore();
  // 用 computed 包装 cesiumStore.viewer 以便 composable 接收 ComputedRef<Viewer | null>
  const viewer = computed(() => cesiumStore.viewer);

  /* ==============================
   *  核心状态
   * ============================== */

  /** 反选模式 */
  const inverse = ref(false);
  /** 所有裁切区域列表 */
  const regions = ref<ClipRegion[]>([]);
  /** 当前选中的区域 ID */
  const activeRegionId = ref<string | null>(null);
  /**
   * 当前活动区域的顶点坐标数组
   * 重要：通过 `positions.value = region.positions` 与 regions[i].positions 共享引用，
   *       对 positions 的修改会直接反映到对应的 region 上。
   */
  const positions = ref<Cartesian3[]>([]);
  /** 是否有任何区域（UI 用） */
  const hasRegions = computed(() => regions.value.length > 0);
  /** 是否有有效（>= 3 顶点）区域（UI 用） */
  const enabled = computed(() => regions.value.some((r) => r.positions.length >= 3));

  /* ==============================
   *  实例化子模块
   * ============================== */

  /** 开始绘制新区域 */
  function startDraw() {
    // 创建新区域并与 positions 建立共享引用
    const region: ClipRegion = { id: genId(), name: `区域 ${regions.value.length + 1}`, positions: [] };
    regions.value.push(region);
    activeRegionId.value = region.id;
    positions.value = region.positions;

    drawing.startDraw();
  }

  /** 历史栈 */
  const history = useClipHistory(positions);

  /** 绘制模式 */
  const drawing = useClipDrawing({
    viewer,
    positions,
    onFinish: () => {
      // 绘制完成 → 记录历史 + 同步裁切 + 保存
      history.pushHistory();
      syncGlobeClipping();
      persistence.save();
    },
    onCancel: () => {
      // 绘制取消/无效 → 移除该空区域
      regions.value = regions.value.filter((r) => r.id !== activeRegionId.value);
      const prev = regions.value.length > 0 ? regions.value[regions.value.length - 1] : null;
      activeRegionId.value = prev?.id ?? null;
      positions.value = prev?.positions ?? [];
      if (!prev) syncGlobeClipping();
    },
  });

  /** 编辑模式 */
  const editing = useClipEditing({
    viewer,
    positions,
    // 进入编辑时记录初始状态快照，以便 undo 回退到此状态
    onStart: () => history.pushHistory(),
    onChange: () => {
      // 顶点变更 → 记录历史 + 同步裁切 + 保存
      history.pushHistory();
      syncGlobeClipping();
      persistence.save();
    },
    // 键盘快捷键：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 重做
    onUndo: undo,
    onRedo: redo,
  });

  /** 持久化 */
  const persistence = useClipPersistence(regions, inverse);

  /* ==============================
   *  撤销 / 重做（带裁切同步）
   * ============================== */

  /** 撤销：历史回退 + 同步 globe + 保存 + 刷新编辑图形 */
  function undo() {
    if (!history.undo()) return;
    syncGlobeClipping();
    persistence.save();
    if (editing.isEditing.value) editing.redraw();
  }

  /** 重做：历史前进 + 同步 globe + 保存 + 刷新编辑图形 */
  function redo() {
    if (!history.redo()) return;
    syncGlobeClipping();
    persistence.save();
    if (editing.isEditing.value) editing.redraw();
  }

  /* ==============================
   *  区域管理
   * ============================== */

  /** 选中某个区域（切换活动区域） */
  function selectRegion(id: string) {
    if (drawing.isDrawing.value || editing.isEditing.value) return;
    const region = regions.value.find((r) => r.id === id);
    if (!region) return;
    activeRegionId.value = region.id;
    // 建立共享引用，后续所有操作针对该区域的顶点
    positions.value = region.positions;
  }

  /** 进入编辑模式（可选指定区域 ID） */
  function startEdit(regionId?: string) {
    const id = regionId ?? activeRegionId.value;
    if (!id) return;
    const region = regions.value.find((r) => r.id === id);
    if (!region || region.positions.length < 3) return;

    if (activeRegionId.value !== id) {
      activeRegionId.value = id;
      positions.value = region.positions;
    }
    editing.startEdit();
  }

  /** 删除指定区域 */
  function clearRegion(id: string) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    if (editing.isEditing.value) editing.stopEdit();
    if (drawing.isDrawing.value) {
      drawing.cancelDraw();
      return;
    }
    regions.value = regions.value.filter((r) => r.id !== id);
    // 如果删除的是当前活动区域，自动切换到最后一个区域
    if (activeRegionId.value === id) {
      const prev = regions.value.length > 0 ? regions.value[regions.value.length - 1] : null;
      activeRegionId.value = prev?.id ?? null;
      positions.value = prev?.positions ?? [];
    }
    syncGlobeClipping();
    persistence.save();
  }

  /** 飞行定位到指定裁切区域 */
  function flyToRegion(id: string) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const region = regions.value.find((r) => r.id === id);
    if (!region || region.positions.length < 3) return;

    // 计算所有顶点的经纬度范围
    let minLng = Infinity,
      maxLng = -Infinity;
    let minLat = Infinity,
      maxLat = -Infinity;
    region.positions.forEach((pos) => {
      const carto = Cartographic.fromCartesian(pos);
      const lng = CesiumMath.toDegrees(carto.longitude);
      const lat = CesiumMath.toDegrees(carto.latitude);
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });

    // 添加边距后飞行
    const pad = 0.02;
    v.camera.flyTo({
      destination: Rectangle.fromDegrees(minLng - pad, minLat - pad, maxLng + pad, maxLat + pad),
      duration: 1.0,
    });
  }

  /** 清除所有区域 */
  function clearAll() {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    if (editing.isEditing.value) editing.stopEdit();
    if (drawing.isDrawing.value) {
      drawing.cancelDraw();
      return;
    }
    regions.value = [];
    activeRegionId.value = null;
    positions.value = [];
    history.reset();
    syncGlobeClipping();
    persistence.clear();
  }

  /* ==============================
   *  同步到 Cesium Globe
   * ============================== */

  /**
   * 将当前 regions 同步到 scene.globe.clippingPolygons
   * 每次调用都会重建 ClippingPolygonCollection
   */
  function syncGlobeClipping() {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    const valid = regions.value.filter((r) => r.positions.length >= 3);
    if (valid.length === 0) {
      // 没有有效区域 → 清空裁切
      v.scene.globe.clippingPolygons = new ClippingPolygonCollection();
      v.scene.globe.depthTestAgainstTerrain = false;
      return;
    }

    v.scene.globe.depthTestAgainstTerrain = true;
    const polygons = valid.map((r) => new ClippingPolygon({ positions: r.positions }));
    v.scene.globe.clippingPolygons = new ClippingPolygonCollection({
      polygons,
      inverse: inverse.value,
    });
  }

  /* ==============================
   *  生命周期
   * ============================== */

  /** 销毁所有子模块资源并重置状态 */
  function destroy() {
    drawing.destroy();
    editing.destroy();
    history.reset();
    const v = toRaw(viewer.value);
    if (isValidViewer(v)) {
      v.scene.globe.clippingPolygons = new ClippingPolygonCollection();
      v.scene.globe.depthTestAgainstTerrain = false;
    }
    regions.value = [];
    activeRegionId.value = null;
    positions.value = [];
    inverse.value = false;
  }

  // 只加载一次标志
  let loadedOnce = false;

  // Viewer 就绪后自动从 localStorage 恢复数据
  watch(
    () => cesiumStore.viewer,
    (v) => {
      if (v && !v.isDestroyed() && !loadedOnce) {
        loadedOnce = true;
        const loaded = persistence.load();
        if (loaded) {
          // 先设 inverse，再设 regions，避免 inverse watcher 时序竞态
          inverse.value = loaded.inverse;
          regions.value = loaded.regions;
          const last = loaded.regions[loaded.regions.length - 1];
          activeRegionId.value = last.id;
          positions.value = last.positions;
          syncGlobeClipping();
        }
      }
      // Viewer 被销毁时清理全部状态
      if (!v) {
        destroy();
        loadedOnce = false;
      }
    },
  );

  /** 切换反选模式 */
  function toggleInverse() {
    inverse.value = !inverse.value;
  }

  // inverse 变更时同步监听
  watch(inverse, () => {
    if (hasRegions.value) {
      syncGlobeClipping();
      persistence.save();
      if (editing.isEditing.value) editing.redraw();
    }
  });

  /* ==============================
   *  导出给 UI 组件使用
   * ============================== */

  return {
    // state
    enabled,
    inverse,
    toggleInverse,
    isDrawing: drawing.isDrawing,
    isEditing: editing.isEditing,
    regions,
    activeRegionId,
    positions,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    hasRegions,
    // drawing
    startDraw,
    cancelDraw: drawing.cancelDraw,
    undoLastVertex: drawing.undoLastVertex,
    // regions
    selectRegion,
    flyToRegion,
    startEdit,
    clearRegion,
    clearAll,
    // editing
    stopEdit: editing.stopEdit,
    // undo / redo
    undo,
    redo,
    // lifecycle
    destroy,
  };
});
