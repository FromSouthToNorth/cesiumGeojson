<!--
  components/Cesium/PointCreator.vue —— 观测点创建面板
  输入经纬度创建标记点，支持采样地形高度，
  创建后可自动围绕旋转，管理已创建的点列表
-->
<template>
  <SidePanel :visible="visible" title="添加观测点" @update:visible="emit('update:visible', $event)">
    <Form layout="vertical" :model="form">
      <Form.Item label="经度 (Longitude)" required>
        <InputNumber
          v-model:value="form.lng"
          :min="-180"
          :max="180"
          :step="0.01"
          :precision="6"
          style="width: 100%"
          placeholder="例如: 116.397"
        />
      </Form.Item>
      <Form.Item label="纬度 (Latitude)" required>
        <InputNumber
          v-model:value="form.lat"
          :min="-90"
          :max="90"
          :step="0.01"
          :precision="6"
          style="width: 100%"
          placeholder="例如: 39.908"
        />
      </Form.Item>
      <Form.Item label="海拔 (Height) 米 — 留空自动使用地形高度">
        <InputNumber
          v-model:value="form.alt"
          :min="-1000"
          :max="90000"
          :step="1"
          style="width: 100%"
          placeholder="留空则采样地形高度"
        />
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
import { ref, reactive, toRaw, h, onUnmounted } from 'vue';
import { Button, Form, InputNumber, Checkbox, Popconfirm, Dropdown, message } from 'ant-design-vue';
import { EnvironmentOutlined, AimOutlined, CloseOutlined, ZoomInOutlined, MoreOutlined } from '@ant-design/icons-vue';
import { useCesiumStore } from '@/stores/cesiumStore';
import { Cartesian3, Cartographic, sampleTerrain, HeadingPitchRange, Math as CesiumMath, Matrix4, Color } from 'cesium';
import type { Viewer, Entity } from 'cesium';
import SidePanel from './SidePanel.vue';

defineOptions({ name: 'PointCreator' });

/* ───────── 类型 ───────── */

interface PointRecord {
  id: number;
  entity: Entity;
  lng: number;
  lat: number;
}

/* ───────── props & emits ───────── */

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();

/* ───────── 状态 ───────── */

const cesiumStore = useCesiumStore();
const isCreating = ref(false);
const autoRotate = ref(true);
const isRotating = ref(false); // 是否正在自动旋转
const rotatingPointId = ref<number | null>(null); // 当前旋转的点 ID
const points = ref<PointRecord[]>([]); // 已创建的所有点
let nextId = 1;

const form = reactive({
  lng: null as number | null,
  lat: null as number | null,
  alt: null as number | null,
});

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
  if (form.lng === null || form.lat === null) {
    message.warning('请填写经度和纬度');
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
    points.value.push({ id: pointId, entity, lng, lat });

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
    emit('update:visible', false);
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

onUnmounted(() => {
  stopRotation();
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
