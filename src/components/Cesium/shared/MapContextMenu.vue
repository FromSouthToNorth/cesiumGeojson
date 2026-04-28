<!--
  MapContextMenu.vue —— 右键上下文菜单
  根据实体类型显示不同的操作项，玻璃态设计
-->
<template>
  <Transition name="menu">
    <div
      v-if="visible"
      class="menu-overlay"
      @click.stop="close"
      @contextmenu.prevent="close"
    >
      <div
        class="context-menu"
        :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
        @click.stop
      >
        <div class="menu-header">
          <span class="menu-title">{{ entityName }}</span>
          <span class="menu-type-badge">{{ typeLabel }}</span>
        </div>
        <div class="menu-divider" />
        <div
          v-for="(item, idx) in actions"
          :key="idx"
          class="menu-item"
          :class="{
            'menu-item--danger': item.danger,
            'menu-item--separator': item.separator,
          }"
          @click="item.separator ? null : handleAction(item)"
        >
          <template v-if="!item.separator">
            <component :is="item.icon" class="menu-item-icon" />
            <span class="menu-item-label">{{ item.label }}</span>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  AimOutlined,
  EditOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  DeleteOutlined,
  RiseOutlined,
  ScissorOutlined,
  PlaySquareOutlined,
  InfoCircleOutlined,
  DragOutlined,
} from '@ant-design/icons-vue';
import type { PickedEntity, ContextMenuAction } from '@/utils/cesium/shared/useMapInteraction';

defineOptions({ name: 'MapContextMenu' });

const props = defineProps<{
  visible: boolean;
  entity: PickedEntity | null;
  pos: { x: number; y: number };
}>();

const emit = defineEmits<{
  close: [];
  action: [payload: { action: ContextMenuAction; entity: PickedEntity }];
}>();

/* ==============================
 *  显示文本
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
    default:
      return '';
  }
});

const geoTypeLabel = computed(() => {
  if (!props.entity || props.entity.type !== 'geojson') return '';
  const e = props.entity.entity;
  if (e.polygon) return 'Polygon';
  if (e.polyline) return 'Polyline';
  if (e.point) return 'Point';
  if (e.corridor) return 'Corridor';
  if (e.rectangle) return 'Rectangle';
  if (e.ellipse) return 'Ellipse';
  return 'Feature';
});

const typeLabel = computed(() => {
  if (!props.entity) return '';
  switch (props.entity.type) {
    case 'geoPolygon':
      return '勘测区域';
    case 'geoPath':
      return '地质路径';
    case 'geojson':
      return `要素 · ${geoTypeLabel.value}`;
    default:
      return '';
  }
});

/* ==============================
 *  菜单项
 * ============================== */

interface MenuItem {
  id: string;
  label?: string;
  icon?: any;
  danger?: boolean;
  separator?: boolean;
}

const actions = computed<MenuItem[]>(() => {
  if (!props.entity) return [];
  switch (props.entity.type) {
    case 'geoPolygon':
      return [
        { id: 'flyTo', label: '飞行定位', icon: AimOutlined },
        { id: 'edit', label: '编辑顶点', icon: EditOutlined },
        { id: 'move', label: '移动', icon: DragOutlined },
        { id: 'toggleVisibility', label: '显隐切换', icon: EyeOutlined },
        { id: 'analyzeSlope', label: '坡度分析', icon: RiseOutlined },
        { id: 'toggleClipping', label: '地形裁切', icon: ScissorOutlined },
        { id: '__sep__', separator: true },
        { id: 'delete', label: '删除多边形', icon: DeleteOutlined, danger: true },
      ];
    case 'geoPath':
      return [
        { id: 'flyTo', label: '飞行定位', icon: AimOutlined },
        { id: 'edit', label: '编辑顶点', icon: EditOutlined },
        { id: 'move', label: '移动', icon: DragOutlined },
        { id: 'toggleVisibility', label: '显隐切换', icon: EyeOutlined },
        { id: 'playback', label: '轨迹播放', icon: PlaySquareOutlined },
        { id: '__sep__', separator: true },
        { id: 'delete', label: '删除路径', icon: DeleteOutlined, danger: true },
      ];
    case 'geojson':
      return [
        { id: 'flyTo', label: '飞行定位', icon: AimOutlined },
        { id: 'toggleVisibility', label: '显隐切换', icon: EyeOutlined },
        { id: 'viewProperties', label: '查看属性', icon: InfoCircleOutlined },
        { id: '__sep__', separator: true },
        { id: 'delete', label: '移出视图', icon: EyeInvisibleOutlined, danger: true },
      ];
    default:
      return [];
  }
});

/* ==============================
 *  事件处理
 * ============================== */

function close() {
  emit('close');
}

function handleAction(item: MenuItem) {
  emit('action', {
    action: { id: item.id, label: item.label ?? '' },
    entity: props.entity,
  });
  close();
}
</script>

<style scoped>
/* ───────── 遮罩层 ───────── */
.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
}

/* ───────── 菜单 ───────── */
.context-menu {
  position: absolute;
  min-width: 180px;
  max-width: 240px;
  padding: 6px;
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  background: var(--surface-bg);
  box-shadow: 0 8px 32px var(--surface-shadow);
  backdrop-filter: blur(12px);
  transform-origin: top left;
}

/* ───────── 头部 ───────── */
.menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px 4px;
}

.menu-title {
  overflow: hidden;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-type-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--panel-surface);
  color: var(--surface-text-muted);
  font-size: 10px;
  line-height: 1.6;
  white-space: nowrap;
}

.menu-divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--surface-border);
}

/* ───────── 菜单项 ───────── */
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  color: var(--surface-text);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.menu-item:hover {
  background: var(--surface-hover);
  color: var(--color-text);
}

.menu-item:active {
  transform: scale(0.97);
}

.menu-item-icon {
  flex-shrink: 0;
  width: 16px;
  font-size: 14px;
  text-align: center;
}

.menu-item-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ───────── 危险操作 ───────── */
.menu-item--danger {
  color: var(--color-danger);
}

.menu-item--danger:hover {
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
}

/* ───────── 分隔项 ───────── */
.menu-item--separator {
  height: 1px;
  margin: 4px 6px;
  padding: 0;
  background: var(--surface-border);
  cursor: default;
  pointer-events: none;
}

/* ───────── 过渡动画 ───────── */
.menu-enter-active {
  transition: all 0.15s ease-out;
}

.menu-leave-active {
  transition: all 0.1s ease-in;
}

.menu-enter-from {
  opacity: 0;
  transform: scale(0.92);
}

.menu-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

@media (prefers-reduced-motion: reduce) {
  .menu-enter-active,
  .menu-leave-active {
    transition: none;
  }

  .menu-enter-from,
  .menu-leave-to {
    opacity: 0;
    transform: none;
  }
}
</style>
