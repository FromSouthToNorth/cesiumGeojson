<!--
  MapPopup.vue —— 左键点击弹出气泡
  玻璃态卡片 + SVG 牵引线连接实体，支持 3 种视觉风格
-->
<template>
  <div
    v-if="visible && entity && screenPos"
    class="popup-shell"
    @click.stop
  >
    <!-- SVG 牵引线 -->
    <svg class="leader-svg">
      <path :d="leaderPath" class="leader-line" />
      <circle
        v-if="leaderPath"
        :cx="screenPos.x"
        :cy="screenPos.y"
        r="3"
        class="leader-dot"
      />
    </svg>

    <!-- 气泡卡片 -->
    <div ref="cardRef" class="popup-card" :class="[`popup-card--${style}`]" :style="cardStyle">
      <!-- 头部 -->
      <div class="pc-header">
        <span class="pc-type-badge" :class="`pc-type-badge--${entity.type}`">
          <span v-if="colorDot" class="pc-color-dot" :style="{ background: colorDot }" />
          {{ typeLabel }}
        </span>
        <div class="pc-header-actions">
          <button class="pc-icon-btn" aria-label="切换样式" @click="cycleVariant">
            <BgColorsOutlined />
          </button>
          <button class="pc-icon-btn" aria-label="关闭" @click="close">
            <CloseOutlined />
          </button>
        </div>
      </div>

      <!-- 主体 -->
      <div class="pc-body">
        <div class="pc-title">{{ entityName }}</div>
        <div class="pc-details">
          <div v-for="(row, i) in detailRows" :key="i" class="pc-detail-row">
            <span class="pc-detail-label">{{ row.label }}</span>
            <span class="pc-detail-value">{{ row.value }}</span>
          </div>
          <!-- GeoJSON 属性 -->
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import {
  AimOutlined,
  EditOutlined,
  RiseOutlined,
  ScissorOutlined,
  PlaySquareOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  BgColorsOutlined,
  CloseOutlined,
} from '@ant-design/icons-vue';
import { useGeoPolygonStore, formatArea, formatDist } from '@/stores/geoPolygonStore';
import { useGeoPathStore } from '@/stores/geoPathStore';
import { useGeoJsonStore } from '@/stores/geojsonStore';
import { useCesiumStore } from '@/stores/cesiumStore';
import type { PickedEntity, PickedEntityGeoPolygon, PickedEntityGeoPath, PickedEntityGeoJson } from '@/utils/cesium/shared/useMapInteraction';
import type { PopupVariantKey } from './popupVariants';
import { getNextVariant } from './popupVariants';

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
 *  内部状态
 * ============================== */

const cardRef = ref<HTMLElement | null>(null);
const cardHeight = ref(180);
const leaderPath = ref('');

/* ==============================
 *  实体名称 & 类型标签
 * ============================== */

const entityName = computed(() => {
  if (!props.entity) return '';
  switch (props.entity.type) {
    case 'geoPolygon': return props.entity.polygon.name;
    case 'geoPath': return props.entity.path.name;
    case 'geojson': return props.entity.feature.name;
    default: return '';
  }
});

const colorDot = computed(() => {
  if (!props.entity) return null;
  if (props.entity.type === 'geoPolygon') return props.entity.polygon.color;
  if (props.entity.type === 'geoPath') return props.entity.path.color;
  return null;
});

const typeLabel = computed(() => {
  if (!props.entity) return '';
  switch (props.entity.type) {
    case 'geoPolygon': return '勘测区域';
    case 'geoPath': return '地质路径';
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
    default: return '';
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
    default: return [];
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

function flyToGeoJson(p: PickedEntityGeoJson) {
  const viewer = useCesiumStore().viewer;
  if (viewer && !(viewer as any).isDestroyed()) {
    (viewer as any).flyTo(p.entity).catch(() => {});
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
      const p = props.entity;
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
      const p = props.entity;
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
      const p = props.entity;
      const visLabel = p.entity.show ? '隐藏' : '显示';
      const visIcon = p.entity.show ? EyeOutlined : EyeInvisibleOutlined;
      return [
        { icon: AimOutlined, label: '飞行', primary: true, handler: () => flyToGeoJson(p) },
        { icon: visIcon, label: visLabel, handler: () => toggleGeoJsonVisibility(p) },
        { icon: EyeInvisibleOutlined, label: '移出', handler: () => removeGeoJson(p) },
      ];
    }
    default: return [];
  }
});

/* ==============================
 *  定位 & 牵引线
 * ============================== */

const POPUP_GAP = 20;
const CARD_WIDTH = 280;
const MARGIN = 8;

const cardStyle = computed(() => {
  if (!props.screenPos) return { display: 'none' };

  let left = props.screenPos.x - CARD_WIDTH / 2;
  let top = props.screenPos.y - cardHeight.value - POPUP_GAP;

  left = Math.max(MARGIN, Math.min(window.innerWidth - CARD_WIDTH - MARGIN, left));
  top = Math.max(MARGIN, top);

  return { left: `${left}px`, top: `${top}px` };
});

function measureCard() {
  if (cardRef.value) {
    const rect = cardRef.value.getBoundingClientRect();
    if (rect.height > 0) {
      cardHeight.value = rect.height;
    }
  }
}

function computeLeaderPath() {
  if (!props.screenPos || !cardRef.value) {
    leaderPath.value = '';
    return;
  }

  const rect = cardRef.value.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    leaderPath.value = '';
    return;
  }

  const startX = rect.left + rect.width / 2;
  const startY = rect.bottom;
  const endX = props.screenPos.x;
  const endY = props.screenPos.y;

  const dx = endX - startX;
  if (Math.abs(dx) < 3) {
    leaderPath.value = `M ${startX} ${startY} L ${endX} ${endY}`;
    return;
  }

  const midY = startY + (endY - startY) * 0.5;
  const ctrlX = startX + dx * 0.3;
  leaderPath.value = `M ${startX} ${startY} Q ${ctrlX} ${midY} ${endX} ${endY}`;
}

watch(
  [() => props.screenPos, () => props.entity, () => props.visible],
  async () => {
    if (props.visible && props.screenPos && props.entity) {
      await nextTick();
      measureCard();
      computeLeaderPath();
    }
  },
  { immediate: false },
);

watch(
  () => props.visible,
  (v) => {
    if (!v) leaderPath.value = '';
  },
);

/* ==============================
 *  样式切换
 * ============================== */

function cycleVariant() {
  emit('update:style', getNextVariant(props.style));
}

function close() {
  emit('close');
}

/* ==============================
 *  窗口 resize
 * ============================== */

function onResize() {
  if (props.visible) {
    nextTick(() => {
      measureCard();
      computeLeaderPath();
    });
  }
}

onMounted(() => {
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
});
</script>

<style scoped>
/* ───────── Shell（不拦截事件） ───────── */
.popup-shell {
  position: fixed;
  inset: 0;
  z-index: 250;
  pointer-events: none;
}

/* ───────── SVG 牵引线 ───────── */
.leader-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.leader-line {
  fill: none;
  stroke: var(--color-primary);
  stroke-width: 1.5px;
  opacity: 0.55;
}

.leader-dot {
  fill: var(--color-primary);
  opacity: 0.7;
}

/* ───────── 气泡卡片 ───────── */
.popup-card {
  position: fixed;
  z-index: 251;
  width: 280px;
  border-radius: 10px;
  pointer-events: auto;
  animation: popupFadeIn 0.2s ease-out;
}

/* ───────── 3 种视觉变体 ───────── */
.popup-card--glass {
  border: 1px solid var(--surface-border);
  background: var(--surface-bg);
  box-shadow: 0 8px 32px var(--surface-shadow);
  backdrop-filter: blur(12px);
}

.popup-card--minimal {
  border: 1px solid var(--surface-border);
  background: color-mix(in srgb, var(--surface-bg) 60%, transparent);
  box-shadow: none;
  backdrop-filter: blur(4px);
}

.popup-card--card {
  border: 1px solid var(--surface-border);
  background: color-mix(in srgb, var(--surface-bg) 95%, #000);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  backdrop-filter: none;
}

/* ───────── 头部 ───────── */
.pc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 6px;
}

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

.pc-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

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

/* ───────── 主体 ───────── */
.pc-body {
  padding: 6px 12px 8px;
}

.pc-title {
  margin-bottom: 6px;
  color: var(--color-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
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

/* ───────── 动画 ───────── */
@keyframes popupFadeIn {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .popup-card {
    animation: none;
  }
}
</style>
