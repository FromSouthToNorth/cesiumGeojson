<!--
  MapPopup.vue —— 左键点击弹出气泡
  内部使用 BubbleDialog 外壳，注入实体类型专属内容
-->
<template>
  <BubbleDialog
    :visible="visible && !!entity"
    :screen-pos="screenPos"
    :style-variant="style"
    :title="entityName"
    :width="280"
    :show-close-button="true"
    @close="close"
  >
    <template #header-left>
      <span v-if="entity" class="pc-type-badge" :class="`pc-type-badge--${entity.type}`">
        <span v-if="colorDot" class="pc-color-dot" :style="{ background: colorDot }" />
        {{ typeLabel }}
      </span>
    </template>
    <template #header-actions>
      <button class="pc-icon-btn" aria-label="切换样式" @click="cycleVariant">
        <BgColorsOutlined />
      </button>
    </template>

    <!-- 主体 -->
    <div class="pc-body">
      <div class="pc-details">
        <div v-for="(row, i) in detailRows" :key="i" class="pc-detail-row">
          <span class="pc-detail-label">{{ row.label }}</span>
          <span class="pc-detail-value">{{ row.value }}</span>
        </div>
        <div v-for="(val, key) in geoProperties" :key="key" class="pc-detail-row">
          <span class="pc-detail-label">{{ key }}</span>
          <span class="pc-detail-value pc-detail-value--prop">{{ val }}</span>
        </div>
      </div>
    </div>

    <!-- 底部操作按钮 -->
    <div class="pc-footer">
      <button
        v-for="(btn, i) in actionButtons"
        :key="i"
        class="pc-footer-btn"
        :class="{ 'pc-footer-btn--primary': btn.primary }"
        @click="btn.handler"
      >
        <component :is="btn.icon" class="pc-footer-btn-icon" />
        <span>{{ btn.label }}</span>
      </button>
    </div>
  </BubbleDialog>
</template>

<script setup lang="ts">
import { computed, toRaw } from 'vue';
import {
  AimOutlined,
  EditOutlined,
  RiseOutlined,
  ScissorOutlined,
  PlaySquareOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  BgColorsOutlined,
} from '@ant-design/icons-vue';
import { useGeoPolygonStore, formatArea, formatDist } from '@/stores/geoPolygonStore';
import { useGeoPathStore } from '@/stores/geoPathStore';
import { useGeoJsonStore } from '@/stores/geojsonStore';
import { Cartesian3, Cartographic, Math as CesiumMath } from 'cesium';
import { useCesiumStore } from '@/stores/cesiumStore';
import type {
  PickedEntity,
  PickedEntityGeoPolygon,
  PickedEntityGeoPath,
  PickedEntityGeoJson,
  PickedEntityPoint,
} from '@/utils/cesium/shared/useMapInteraction';
import type { PopupVariantKey } from './popupVariants';
import { getNextVariant } from './popupVariants';
import BubbleDialog from './BubbleDialog.vue';

defineOptions({ name: 'MapPopup' });

const props = defineProps<{
  visible: boolean;
  entity: PickedEntity;
  screenPos: { x: number; y: number } | null;
  style: PopupVariantKey;
}>();

const emit = defineEmits<{
  close: [];
  'update:style': [style: PopupVariantKey];
}>();

/* ==============================
 *  实体名称 & 类型标签
 * ============================== */

const entityName = computed(() => {
  if (!props.entity) return '';
  switch (props.entity.type) {
    case 'geoPolygon':
      return props.entity.polygon.name;
    case 'geoPath':
      return props.entity.path.name;
    case 'geojson':
      return props.entity.feature.name;
    case 'point':
      return '观测点';
    default:
      return '';
  }
});

const colorDot = computed(() => {
  if (!props.entity) return null;
  if (props.entity.type === 'geoPolygon') return props.entity.polygon.color;
  if (props.entity.type === 'geoPath') return props.entity.path.color;
  if (props.entity.type === 'point') return '#ff4d4f';
  return null;
});

const typeLabel = computed(() => {
  if (!props.entity) return '';
  switch (props.entity.type) {
    case 'geoPolygon':
      return '勘测区域';
    case 'geoPath':
      return '地质路径';
    case 'geojson': {
      const e = props.entity.entity;
      if (e.polygon) return '多边形要素';
      if (e.polyline) return '线要素';
      if (e.point) return '点要素';
      if (e.corridor) return 'Corridor';
      if (e.rectangle) return 'Rectangle';
      if (e.ellipse) return 'Ellipse';
      return '要素';
    }
    case 'point':
      return '观测点';
    default:
      return '';
  }
});

/* ==============================
 *  详情行
 * ============================== */

const detailRows = computed(() => {
  if (!props.entity) return [];
  switch (props.entity.type) {
    case 'geoPolygon': {
      const p = props.entity.polygon;
      return [
        { label: '面积', value: formatArea(p.measurements.area) },
        { label: '周长', value: formatDist(p.measurements.perimeter) },
        { label: '顶点', value: `${p.positions.length} 个` },
      ];
    }
    case 'geoPath': {
      const p = props.entity.path;
      return [
        { label: '总距离', value: formatDist(p.measurements.total) },
        { label: '顶点', value: `${p.positions.length} 个` },
      ];
    }
    case 'geojson': {
      return [{ label: '图层', value: props.entity.layer.name }];
    }
    case 'point': {
      const carto = Cartographic.fromCartesian(props.entity.position);
      const lng = CesiumMath.toDegrees(carto.longitude).toFixed(6);
      const lat = CesiumMath.toDegrees(carto.latitude).toFixed(6);
      const alt = carto.height != null ? carto.height.toFixed(1) + ' m' : '—';
      return [
        { label: '经度', value: lng },
        { label: '纬度', value: lat },
        { label: '海拔', value: alt },
      ];
    }
    default:
      return [];
  }
});

const geoProperties = computed(() => {
  if (!props.entity || props.entity.type !== 'geojson') return {};
  const raw = props.entity.feature.properties;
  const keys = Object.keys(raw).filter((k) => k !== 'name' && k !== 'title' && k !== 'id');
  const result: Record<string, string> = {};
  let count = 0;
  for (const key of keys) {
    if (count >= 4) break;
    const val = raw[key];
    if (val !== undefined && val !== null && val !== '') {
      result[key] = typeof val === 'string' ? val : JSON.stringify(val);
      count++;
    }
  }
  return result;
});

/* ==============================
 *  操作按钮
 * ============================== */

interface ActionBtn {
  icon: any;
  label: string;
  primary?: boolean;
  handler: () => void;
}

function flyToPolygon(p: PickedEntityGeoPolygon) {
  useGeoPolygonStore().flyToPolygon(p.polygon.id);
  emit('close');
}

function flyToPath(p: PickedEntityGeoPath) {
  useGeoPathStore().flyToPath(p.path.id);
  emit('close');
}

function flyToPoint(p: PickedEntityPoint) {
  const viewer = useCesiumStore().viewer;
  if (viewer && !(viewer as any).isDestroyed()) {
    const v = toRaw(viewer);
    const carto = Cartographic.fromCartesian(p.position);
    const dest = Cartesian3.fromDegrees(
      CesiumMath.toDegrees(carto.longitude),
      CesiumMath.toDegrees(carto.latitude),
      Math.max(carto.height + 1000, 1000),
    );
    v.camera.flyTo({ destination: dest, duration: 1 });
  }
  emit('close');
}

function flyToGeoJson(p: PickedEntityGeoJson) {
  const viewer = useCesiumStore().viewer;
  if (viewer && !(viewer as any).isDestroyed()) {
    const v = toRaw(viewer);
    v.flyTo(p.entity).catch(() => {});
  }
  emit('close');
}

function editPolygon(p: PickedEntityGeoPolygon) {
  useGeoPolygonStore().startEdit(p.polygon.id);
  emit('close');
}

function editPath(p: PickedEntityGeoPath) {
  useGeoPathStore().startEdit(p.path.id);
  emit('close');
}

function togglePolygonVisibility(p: PickedEntityGeoPolygon) {
  useGeoPolygonStore().toggleVisibility(p.polygon.id);
}

function togglePathVisibility(p: PickedEntityGeoPath) {
  useGeoPathStore().toggleVisibility(p.path.id);
}

function toggleGeoJsonVisibility(p: PickedEntityGeoJson) {
  useGeoJsonStore().toggleLayerVisibility(p.layer.id);
}

function analyzeSlope(p: PickedEntityGeoPolygon) {
  const store = useGeoPolygonStore();
  store.selectPolygon(p.polygon.id);
  store.analyzeSlope(p.polygon.id);
  emit('close');
}

function toggleClipping(p: PickedEntityGeoPolygon) {
  useGeoPolygonStore().toggleClipping(p.polygon.id);
}

function playbackPath(p: PickedEntityGeoPath) {
  const store = useGeoPathStore();
  store.selectPath(p.path.id);
  store.startPlayback(p.path);
  emit('close');
}

function removeGeoJson(p: PickedEntityGeoJson) {
  p.entity.show = false;
}

const actionButtons = computed<ActionBtn[]>(() => {
  if (!props.entity) return [];
  switch (props.entity.type) {
    case 'geoPolygon': {
      const p = toRaw(props.entity);
      const visLabel = p.polygon.show ? '隐藏' : '显示';
      const visIcon = p.polygon.show ? EyeOutlined : EyeInvisibleOutlined;
      return [
        { icon: AimOutlined, label: '飞行', primary: true, handler: () => flyToPolygon(p) },
        { icon: EditOutlined, label: '编辑', handler: () => editPolygon(p) },
        { icon: visIcon, label: visLabel, handler: () => togglePolygonVisibility(p) },
        { icon: RiseOutlined, label: '坡度', handler: () => analyzeSlope(p) },
        { icon: ScissorOutlined, label: '裁切', handler: () => toggleClipping(p) },
      ];
    }
    case 'geoPath': {
      const p = toRaw(props.entity);
      const visLabel = p.path.show ? '隐藏' : '显示';
      const visIcon = p.path.show ? EyeOutlined : EyeInvisibleOutlined;
      return [
        { icon: AimOutlined, label: '飞行', primary: true, handler: () => flyToPath(p) },
        { icon: EditOutlined, label: '编辑', handler: () => editPath(p) },
        { icon: visIcon, label: visLabel, handler: () => togglePathVisibility(p) },
        { icon: PlaySquareOutlined, label: '播放', handler: () => playbackPath(p) },
      ];
    }
    case 'geojson': {
      const p = toRaw(props.entity);
      const visLabel = p.entity.show ? '隐藏' : '显示';
      const visIcon = p.entity.show ? EyeOutlined : EyeInvisibleOutlined;
      return [
        { icon: AimOutlined, label: '飞行', primary: true, handler: () => flyToGeoJson(p) },
        { icon: visIcon, label: visLabel, handler: () => toggleGeoJsonVisibility(p) },
        { icon: EyeInvisibleOutlined, label: '移出', handler: () => removeGeoJson(p) },
      ];
    }
    case 'point': {
      const p = toRaw(props.entity);
      return [{ icon: AimOutlined, label: '飞行', primary: true, handler: () => flyToPoint(p) }];
    }
    default:
      return [];
  }
});

/* ==============================
 *  样式切换 & 关闭
 * ============================== */

function cycleVariant() {
  emit('update:style', getNextVariant(props.style));
}

function close() {
  emit('close');
}
</script>

<style scoped>
/* ───────── 类型徽章 ───────── */
.pc-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--panel-surface);
  color: var(--surface-text-muted);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2px;
  line-height: 1.6;
}

.pc-color-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ───────── 主体 ───────── */
.pc-body {
  padding: 6px 12px 8px;
}

.pc-details {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.pc-detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pc-detail-label {
  color: var(--surface-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.pc-detail-value {
  color: var(--surface-text);
  font-size: 12px;
  font-weight: 500;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pc-detail-value--prop {
  max-width: 160px;
  font-weight: 400;
}

/* ───────── 底部操作栏 ───────── */
.pc-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 10px 10px;
}

.pc-footer-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--surface-border);
  border-radius: 5px;
  background: transparent;
  color: var(--surface-text);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.pc-footer-btn:hover {
  background: var(--surface-hover);
  border-color: var(--surface-border);
  color: var(--color-text);
}

.pc-footer-btn:active {
  transform: scale(0.96);
}

.pc-footer-btn--primary {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
}

.pc-footer-btn--primary:hover {
  background: color-mix(in srgb, var(--color-primary) 20%, transparent);
  color: var(--color-primary);
}

.pc-footer-btn-icon {
  font-size: 12px;
}

/* ───────── 图标按钮（样式切换） ───────── */
.pc-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--surface-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.pc-icon-btn:hover {
  background: var(--surface-hover);
  color: var(--color-text);
}
</style>
