<!--
  components/Cesium/PointCreator.vue —— 观测点创建面板
  输入经纬度创建标记点，支持采样地形高度，
  创建后可自动围绕旋转，管理已创建的点列表
-->
<template>
  <SidePanel :visible="visible" title="添加观测点" @update:visible="emit('update:visible', $event)">
    <!-- 地图选点模式 -->
    <div class="map-draw-section">
      <Button block :type="isMapDrawing ? 'primary' : 'default'" :danger="isMapDrawing" aria-label="地图选点"
        @click="toggleMapDrawing">
        <PushpinOutlined /> {{ isMapDrawing ? '取消选点' : '地图选点' }}
      </Button>
      <div v-if="isMapDrawing" class="map-draw-hint">
        <AimOutlined /> 点击地图放置观测点，<kbd>Esc</kbd> 取消，<kbd>Shift</kbd> 临时禁用吸附
      </div>
    </div>

    <div class="divider-text">或手动输入坐标</div>

    <Form layout="vertical" :model="form">
      <Form.Item label="经度 (Longitude)" required :validate-status="validation.lng.status" :help="validation.lng.help">
        <InputNumber v-model:value="form.lng" :min="-180" :max="180" :step="0.01" :precision="6" style="width: 100%"
          placeholder="例如: 116.397" @blur="validateLng" />
      </Form.Item>
      <Form.Item label="纬度 (Latitude)" required :validate-status="validation.lat.status" :help="validation.lat.help">
        <InputNumber v-model:value="form.lat" :min="-90" :max="90" :step="0.01" :precision="6" style="width: 100%"
          placeholder="例如: 39.908" @blur="validateLat" />
      </Form.Item>
      <Form.Item label="海拔 (Height) 米 — 留空自动使用地形高度" :validate-status="validation.alt.status"
        :help="validation.alt.help">
        <InputNumber v-model:value="form.alt" :min="-1000" :max="90000" :step="1" style="width: 100%"
          placeholder="留空则采样地形高度" @blur="validateAlt" />
      </Form.Item>
      <Form.Item>
        <Checkbox v-model:checked="keepOpen">保持面板开启（连续创建）</Checkbox>
      </Form.Item>
      <Form.Item>
        <Checkbox v-model:checked="autoRotate">创建后自动围绕旋转</Checkbox>
      </Form.Item>
      <Form.Item>
        <Button type="primary" block :loading="isCreating" @click="handleCreate">
          <EnvironmentOutlined /> 创建点位
        </Button>
      </Form.Item>
    </Form>

    <div v-if="points.length" class="points-section">
      <div class="points-header">
        <span class="points-count">已创建 {{ points.length }} 个标记点</span>
        <Popconfirm title="确认清除所有标记点？" @confirm="clearAllPoints">
          <Button danger size="small" type="dashed">清除全部</Button>
        </Popconfirm>
      </div>
      <div class="points-list">
        <div v-for="(p, i) in points" :key="p.id" class="point-item">
          <div class="point-info">
            <span class="point-index">{{ i + 1 }}</span>
            <span class="point-coords">{{ p.lng.toFixed(4) }}, {{ p.lat.toFixed(4) }}</span>
          </div>
          <Dropdown :menu="{ items: menuItems(p), onClick: ({ key }) => handleMenuClick(key as string, p, i) }">
            <Button type="text" size="small" class="action-btn">
              <MoreOutlined />
            </Button>
          </Dropdown>
        </div>
      </div>
    </div>
  </SidePanel>
</template>

<script setup lang="ts">
import { ref, reactive, toRaw, h, computed, watch, onUnmounted } from 'vue';
import { Button, Form, InputNumber, Checkbox, Popconfirm, Dropdown, message } from 'ant-design-vue';
import { EnvironmentOutlined, AimOutlined, CloseOutlined, ZoomInOutlined, MoreOutlined, PushpinOutlined } from '@ant-design/icons-vue';
import { useCesiumStore } from '@/stores/cesiumStore';
import { Cartesian3, Cartographic, sampleTerrain, HeadingPitchRange, Math as CesiumMath, Matrix4, Color, ScreenSpaceEventHandler, ScreenSpaceEventType, HeightReference } from 'cesium';
import type { Viewer, Entity } from 'cesium';
import { pickGlobe } from '@/utils/cesium/shared/common';
import { useSnapping } from '@/utils/cesium/shared/useSnapping';
import type { SnapSource } from '@/utils/cesium/shared/useSnapping';
import { useGeoPathStore } from '@/stores/geoPathStore';
import { useGeoPolygonStore } from '@/stores/geoPolygonStore';
import { SidePanel } from '.';

defineOptions({ name: 'PointCreator' });

/* ───────── 类型 ───────── */

interface PointRecord {
  id: number;
  entity: Entity;
  lng: number;
  lat: number;
  position: Cartesian3;
}

/* ───────── props & emits ───────── */

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();

/* ───────── 状态 ───────── */

const cesiumStore = useCesiumStore();
const isCreating = ref(false);
const autoRotate = ref(true);
const keepOpen = ref(false); // 连续创建模式：保持面板开启
const isRotating = ref(false); // 是否正在自动旋转
const rotatingPointId = ref<number | null>(null); // 当前旋转的点 ID
const points = ref<PointRecord[]>([]); // 已创建的所有点
const isMapDrawing = ref(false);
let mapHandler: ScreenSpaceEventHandler | null = null;
let escapeKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let shiftPressed = false;
let shiftDownHandler: ((e: KeyboardEvent) => void) | null = null;
let shiftUpHandler: ((e: KeyboardEvent) => void) | null = null;
let nextId = 1;

const viewerRef = computed(() => cesiumStore.viewer);

const snapping = useSnapping({
  viewer: viewerRef,
  collectTargets: () => {
    const targets: SnapSource[] = [];
    try {
      const pathStore = useGeoPathStore();
      pathStore.paths.forEach((p) => {
        p.positions.forEach((pt) => targets.push({ position: pt, sourceType: 'path' }));
        for (let i = 0; i < p.positions.length - 1; i++) {
          targets.push({
            position: Cartesian3.midpoint(p.positions[i], p.positions[i + 1], new Cartesian3()),
            sourceType: 'path',
            isMidpoint: true,
          });
        }
      });
    } catch { /* store may not be initialized */ }
    try {
      const polyStore = useGeoPolygonStore();
      polyStore.polygons.forEach((p) => {
        p.positions.forEach((pt) => targets.push({ position: pt, sourceType: 'polygon' }));
        const n = p.positions.length;
        for (let i = 0; i < n; i++) {
          const next = (i + 1) % n;
          targets.push({
            position: Cartesian3.midpoint(p.positions[i], p.positions[next], new Cartesian3()),
            sourceType: 'polygon',
            isMidpoint: true,
          });
        }
      });
    } catch { /* store may not be initialized */ }
    // 自己的点作为吸附目标
    points.value.forEach((p) => targets.push({ position: p.position, sourceType: 'point' }));
    return targets;
  },
});

const form = reactive({
  lng: null as number | null,
  lat: null as number | null,
  alt: null as number | null,
});

/** 表单字段验证状态 */
const validation = reactive({
  lng: { status: '' as '' | 'error', help: '' },
  lat: { status: '' as '' | 'error', help: '' },
  alt: { status: '' as '' | 'error', help: '' },
});

/** 验证经度 */
function validateLng() {
  if (form.lng === null) {
    validation.lng = { status: 'error', help: '请输入经度' };
    return false;
  }
  if (form.lng < -180 || form.lng > 180) {
    validation.lng = { status: 'error', help: '经度范围应为 -180 ~ 180' };
    return false;
  }
  validation.lng = { status: '', help: '' };
  return true;
}

/** 验证纬度 */
function validateLat() {
  if (form.lat === null) {
    validation.lat = { status: 'error', help: '请输入纬度' };
    return false;
  }
  if (form.lat < -90 || form.lat > 90) {
    validation.lat = { status: 'error', help: '纬度范围应为 -90 ~ 90' };
    return false;
  }
  validation.lat = { status: '', help: '' };
  return true;
}

/** 验证海拔 */
function validateAlt() {
  if (form.alt !== null && (form.alt < -1000 || form.alt > 90000)) {
    validation.alt = { status: 'error', help: '海拔范围应为 -1000 ~ 90000 米' };
    return false;
  }
  validation.alt = { status: '', help: '' };
  return true;
}

/** 验证整个表单 */
function validateForm(): boolean {
  return validateLng() && validateLat() && validateAlt();
}

/* ───────── 旋转控制 ───────── */

let removeTickListener: (() => void) | null = null;
let cleanupUserInput: (() => void) | null = null;

/** 停止自动旋转，恢复相机变换 */
function stopRotation() {
  isRotating.value = false;
  rotatingPointId.value = null;

  if (removeTickListener) {
    removeTickListener();
    removeTickListener = null;
  }
  if (cleanupUserInput) {
    cleanupUserInput();
    cleanupUserInput = null;
  }
  const v = toRaw(cesiumStore.viewer);
  if (v && !v.isDestroyed()) {
    v.camera.lookAtTransform(Matrix4.IDENTITY);
  }
}

/* ───────── 点列表操作 ───────── */

function menuItems(p: PointRecord) {
  const isCurrent = isRotating.value && rotatingPointId.value === p.id;
  return [
    { key: 'fly', icon: h(AimOutlined), label: '定位到该点' },
    { key: 'rotate', icon: h(ZoomInOutlined), label: isCurrent ? '停止旋转' : '围绕旋转' },
    { key: 'delete', icon: h(CloseOutlined), label: '删除该点', danger: true },
  ];
}

function handleMenuClick(key: string, p: PointRecord, index: number) {
  if (key === 'fly') flyToPoint(p);
  else if (key === 'rotate') toggleRotate(p);
  else if (key === 'delete') removePoint(index);
}

function toggleRotate(p: PointRecord) {
  const v = toRaw(cesiumStore.viewer);
  if (!v || v.isDestroyed()) return;

  // 如果已旋转该点则停止
  if (isRotating.value && rotatingPointId.value === p.id) {
    stopRotation();
    return;
  }

  stopRotation();
  const pos = p.entity.position?.getValue(v.clock.currentTime);
  if (!pos) return;
  startRotation(v, pos, p.id);
}

/** 删除指定索引的点 */
function removePoint(index: number) {
  const p = points.value[index];
  if (!p) return;
  const v = toRaw(cesiumStore.viewer);
  if (v && !v.isDestroyed()) {
    v.entities.remove(p.entity);
  }
  points.value.splice(index, 1);
  stopRotation();
}

/** 清除所有点 */
function clearAllPoints() {
  const v = toRaw(cesiumStore.viewer);
  if (v && !v.isDestroyed()) {
    points.value.forEach((p) => v.entities.remove(p.entity));
  }
  points.value = [];
  stopRotation();
}

/** 飞行定位到点 */
function flyToPoint(p: PointRecord) {
  const v = toRaw(cesiumStore.viewer);
  if (!v || v.isDestroyed()) return;
  const pos = p.entity.position?.getValue(v.clock.currentTime);
  if (!pos) return;
  const carto = Cartographic.fromCartesian(pos);
  v.camera.flyTo({
    destination: Cartesian3.fromDegrees(
      CesiumMath.toDegrees(carto.longitude),
      CesiumMath.toDegrees(carto.latitude),
      carto.height + 1000,
    ),
    duration: 1,
  });
}

/* ───────── 创建点位 ───────── */

async function handleCreate() {
  if (!validateForm()) {
    return;
  }

  const v = toRaw(cesiumStore.viewer);
  if (!v || v.isDestroyed()) return;

  isCreating.value = true;

  try {
    // 确定高度：手动输入优先，否则采样地形
    let height: number;
    if (form.alt !== null) {
      height = form.alt;
    } else {
      const positions = await sampleTerrain(v.terrainProvider, 11, [Cartographic.fromDegrees(form.lng, form.lat)]);
      const sampled = positions[0].height;
      height = sampled != null && isFinite(sampled) ? sampled : 0;
    }

    const position = Cartesian3.fromDegrees(form.lng, form.lat, height);
    const lng = form.lng;
    const lat = form.lat;

    // 添加 Cesium 实体（红色点 + 坐标标签）
    const entity = v.entities.add({
      position,
      point: {
        pixelSize: 14,
        color: Color.RED,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${lng.toFixed(4)}, ${lat.toFixed(4)}`,
        font: '13px sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        pixelOffset: { x: 0, y: -20 },
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      description: `经度: ${lng}, 纬度: ${lat}, 海拔: ${height.toFixed(1)} m`,
    });

    const pointId = nextId++;
    points.value.push({ id: pointId, entity, lng, lat, position });
    snapping.invalidateCache();

    stopRotation();

    // 飞行到新点位
    v.camera.flyTo({
      destination: Cartesian3.fromDegrees(lng, lat, height + 1000),
      orientation: { heading: CesiumMath.toRadians(0), pitch: CesiumMath.toRadians(-30), roll: 0 },
      duration: 1.5,
      complete: () => {
        if (autoRotate.value) {
          startRotation(v, position, pointId);
        }
      },
    });

    message.success(`点位已创建 (海拔: ${height.toFixed(1)} m)`);
    if (!keepOpen.value) {
      emit('update:visible', false);
    }
  } catch (err) {
    console.error('创建点位失败:', err);
    message.error('创建点位失败');
  } finally {
    isCreating.value = false;
  }
}

/* ───────── 地图选点 ───────── */

function toggleMapDrawing() {
  if (isMapDrawing.value) {
    stopMapDrawing();
  } else {
    startMapDrawing();
  }
}

function startMapDrawing() {
  const v = toRaw(cesiumStore.viewer);
  if (!v || v.isDestroyed()) return;

  isMapDrawing.value = true;
  v.canvas.style.cursor = 'crosshair';

  // 吸附设置
  snapping.setup();

  // Shift 键状态跟踪（临时禁用吸附）
  shiftPressed = false;
  shiftDownHandler = (e: KeyboardEvent) => {
    if (e.key === 'Shift') shiftPressed = true;
  };
  shiftUpHandler = (e: KeyboardEvent) => {
    if (e.key === 'Shift') shiftPressed = false;
  };
  window.addEventListener('keydown', shiftDownHandler);
  window.addEventListener('keyup', shiftUpHandler);

  mapHandler = new ScreenSpaceEventHandler(v.canvas);
  mapHandler.setInputAction((movement: any) => {
    const v2 = toRaw(cesiumStore.viewer);
    if (!v2 || v2.isDestroyed()) return;
    const cartesian = pickGlobe(v2, movement.position);
    if (cartesian) {
      const snapResult = snapping.findSnapTarget(movement.position, cartesian, undefined, shiftPressed);
      const finalPos = snapResult ? snapResult.position : cartesian;
      createPointFromPosition(finalPos);
      if (!keepOpen.value) {
        stopMapDrawing();
      }
    }
  }, ScreenSpaceEventType.LEFT_CLICK);

  // 鼠标移动：吸附预览（使用 requestAnimationFrame 节流）
  let _rafId: number | null = null;
  let _pendingMousePos: any = null;
  mapHandler.setInputAction((movement: any) => {
    if (!isMapDrawing.value) return;
    _pendingMousePos = movement.endPosition;
    if (_rafId !== null) return;
    _rafId = requestAnimationFrame(() => {
      _rafId = null;
      const v2 = toRaw(cesiumStore.viewer);
      if (!v2 || v2.isDestroyed() || !_pendingMousePos) return;
      const cartesian = pickGlobe(v2, _pendingMousePos);
      if (cartesian) {
        const snapResult = snapping.findSnapTarget(_pendingMousePos, cartesian, undefined, shiftPressed);
        v2.canvas.style.cursor = snapResult ? 'copy' : 'crosshair';
      }
      _pendingMousePos = null;
    });
  }, ScreenSpaceEventType.MOUSE_MOVE);

  // 右键结束绘制
  mapHandler.setInputAction(() => {
    stopMapDrawing();
  }, ScreenSpaceEventType.RIGHT_CLICK);

  // 使用捕获阶段监听，在 SidePanel 的文档监听器之前拦截 Escape
  escapeKeyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      stopMapDrawing();
    } else if (e.key === 'Backspace' && points.value.length > 0) {
      e.preventDefault();
      removePoint(points.value.length - 1);
      message.info('已撤销最后一个观测点');
    }
  };
  window.addEventListener('keydown', escapeKeyHandler, { capture: true });
}

function stopMapDrawing() {
  if (mapHandler) {
    mapHandler.destroy();
    mapHandler = null;
  }
  if (escapeKeyHandler) {
    window.removeEventListener('keydown', escapeKeyHandler, { capture: true });
    escapeKeyHandler = null;
  }
  if (shiftDownHandler) {
    window.removeEventListener('keydown', shiftDownHandler);
    shiftDownHandler = null;
  }
  if (shiftUpHandler) {
    window.removeEventListener('keyup', shiftUpHandler);
    shiftUpHandler = null;
  }
  snapping.teardown();
  const v = toRaw(cesiumStore.viewer);
  if (v && !v.isDestroyed()) {
    v.canvas.style.cursor = 'default';
  }
  isMapDrawing.value = false;
}

async function createPointFromPosition(cartesian: Cartesian3) {
  const v = toRaw(cesiumStore.viewer);
  if (!v || v.isDestroyed()) return;

  const carto = Cartographic.fromCartesian(cartesian);
  const lng = CesiumMath.toDegrees(carto.longitude);
  const lat = CesiumMath.toDegrees(carto.latitude);

  isCreating.value = true;
  try {
    let position: Cartesian3;
    const useCustomAlt = form.alt !== null;

    if (useCustomAlt) {
      const alt = form.alt as number;
      position = Cartesian3.fromDegrees(lng, lat, alt);
    } else {
      position = cartesian;
    }

    const entityId = `point_${nextId}`;
    const pointId = nextId;

    // 计算海拔显示值
    const altDisplay = useCustomAlt ? (form.alt as number) : (carto.height ?? 0);

    const entity = v.entities.add({
      id: entityId,
      position,
      point: {
        pixelSize: 14,
        color: Color.RED,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: useCustomAlt ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: `${lng.toFixed(4)}, ${lat.toFixed(4)}`,
        font: '13px sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        pixelOffset: { x: 0, y: -20 },
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: useCustomAlt ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
      },
      description: `经度: ${lng}, 纬度: ${lat}, 海拔: ${altDisplay.toFixed(1)} m${useCustomAlt ? ' (手动)' : ' (地形)'}`,
    });

    // 存储自删除回调，供右键菜单使用（按 ID 查找，避免引用不一致）
    (entity as any)._removeSelf = () => {
      const idx = points.value.findIndex((p) => p.id === pointId);
      if (idx >= 0) removePoint(idx);
    };

    nextId++;
    points.value.push({ id: pointId, entity, lng, lat, position });
    snapping.invalidateCache();

    stopRotation();
    message.success(`点位已创建 (海拔: ${altDisplay.toFixed(1)} m)`);

    if (autoRotate.value) {
      startRotation(v, position, pointId);
    }
  } catch (err) {
    console.error('创建点位失败:', err);
    message.error('创建点位失败');
  } finally {
    isCreating.value = false;
  }
}

/* ───────── 自动旋转逻辑 ───────── */

/**
 * 启动围绕指定点的自动旋转
 * 使用 clock.onTick 每帧更新 heading，同时监听鼠标/滚轮事件停止旋转
 */
function startRotation(viewer: Viewer, center: Cartesian3, pointId: number) {
  const pitch = CesiumMath.toRadians(-30);
  const range = 1500;

  let heading = 0;
  viewer.camera.lookAt(center, new HeadingPitchRange(heading, pitch, range));

  isRotating.value = true;
  rotatingPointId.value = pointId;

  // 每帧递增 heading
  removeTickListener = viewer.clock.onTick.addEventListener(() => {
    heading += 0.005;
    viewer.camera.lookAt(center, new HeadingPitchRange(heading, pitch, range));
  });

  // 用户交互时停止旋转
  const canvas = viewer.canvas;
  const onMouseDown = () => stopRotation();
  const onWheel = () => stopRotation();
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('wheel', onWheel);
  cleanupUserInput = () => {
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('wheel', onWheel);
  };
}

/* ───────── 全局撤销快捷键 ───────── */

let globalUndoHandler: ((e: KeyboardEvent) => void) | null = null;

function setupGlobalUndo() {
  globalUndoHandler = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && points.value.length > 0) {
      e.preventDefault();
      removePoint(points.value.length - 1);
      message.info('已撤销最后一个观测点');
    }
  };
  window.addEventListener('keydown', globalUndoHandler);
}

function teardownGlobalUndo() {
  if (globalUndoHandler) {
    window.removeEventListener('keydown', globalUndoHandler);
    globalUndoHandler = null;
  }
}

setupGlobalUndo();

// 面板关闭时停止地图绘制，防止残留事件处理器
watch(
  () => props.visible,
  (visible) => {
    if (!visible) stopMapDrawing();
  },
);

onUnmounted(() => {
  teardownGlobalUndo();
  stopRotation();
  stopMapDrawing();
  snapping.destroy();
});
</script>

<style scoped>
.points-section {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--surface-border);
}

.points-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.points-count {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.points-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
}

.point-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--surface-hover);
  transition: background 0.2s;
}

.point-item:hover {
  background: var(--nav-btn-hover-bg);
}

.point-info {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.point-index {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--color-primary);
  color: #fff;
  font-size: 11px;
}

.point-coords {
  overflow: hidden;
  color: var(--color-text);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-draw-section {
  margin-bottom: 8px;
}

.map-draw-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
  padding: 8px;
  border-radius: 6px;
  background: var(--color-primary, #1677ff);
  color: #fff;
  font-size: 13px;
}

.map-draw-hint kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 4px;
  border: 1px solid rgba(255 255 255 / 0.4);
  border-radius: 3px;
  background: rgba(255 255 255 / 0.15);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
}

.divider-text {
  position: relative;
  margin: 16px 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  text-align: center;
}

.divider-text::before,
.divider-text::after {
  position: absolute;
  top: 50%;
  width: calc(50% - 48px);
  height: 1px;
  background: var(--surface-border);
  content: '';
}

.divider-text::before {
  left: 0;
}

.divider-text::after {
  right: 0;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 4px;
}
</style>
