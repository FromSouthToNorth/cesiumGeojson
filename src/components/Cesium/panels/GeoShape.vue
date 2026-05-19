<!--
  components/Cesium/GeoShape.vue —— 圆形/矩形绘制面板
  支持圆形（圆心+半径）和矩形（两角点）的绘制、管理
-->
<template>
  <SidePanel
    :visible="visible"
    title="形状绘制"
    :disable-escape="store.isDrawing"
    @update:visible="emit('update:visible', $event)"
  >
    <!-- ── 状态1：空闲（无形状 + 非绘制） ── -->
    <template v-if="!store.isDrawing && !store.hasShapes">
      <div class="empty-state">
        <p class="hint">选择形状类型开始在地图上绘制</p>
        <Button type="primary" block @click="store.startDraw('circle')">
          <span class="shape-icon">&#9679;</span>
          绘制圆形
        </Button>
        <Button block @click="store.startDraw('rectangle')">
          <span class="shape-icon">&#9632;</span>
          绘制矩形
        </Button>
        <p class="hint-detail">
          圆形：左键点击设置圆心 → 移动预览 → 再次点击确认半径<br />
          矩形：左键点击设置第一个角 → 移动预览 → 再次点击确认对角点<br />
          右键或 <kbd>Esc</kbd> 取消
        </p>
      </div>
    </template>

    <!-- ── 状态2：绘制中 ── -->
    <template v-if="store.isDrawing">
      <div class="drawing-header">
        <span class="drawing-name">
          {{ store.activeTool === 'circle' ? '绘制圆形' : '绘制矩形' }}
        </span>
      </div>
      <!-- 实时测量 -->
      <div v-if="store.liveMeasure" class="live-measure">
        <template v-if="store.activeTool === 'circle'">
          <div class="measure-row">
            <span class="measure-label">半径</span>
            <span class="measure-value">{{ formatDist(store.liveMeasure.value1) }}</span>
          </div>
          <div class="measure-row">
            <span class="measure-label">周长</span>
            <span class="measure-value">{{ formatDist(store.liveMeasure.value2) }}</span>
          </div>
        </template>
        <template v-else>
          <div class="measure-row">
            <span class="measure-label">宽度</span>
            <span class="measure-value">{{ formatDist(store.liveMeasure.value1) }}</span>
          </div>
          <div class="measure-row">
            <span class="measure-label">高度</span>
            <span class="measure-value">{{ formatDist(store.liveMeasure.value2) }}</span>
          </div>
        </template>
      </div>
      <div v-else class="instructions">
        <p v-if="store.activeTool === 'circle'">左键点击地图设置<span class="highlight">圆心</span></p>
        <p v-else>左键点击地图设置<span class="highlight">第一个角点</span></p>
      </div>
      <div v-if="store.liveMeasure" class="instructions">
        <p>移动鼠标调整大小，左键确认，右键或 <kbd>Esc</kbd> 取消</p>
      </div>
      <Button danger block @click="store.cancelDraw()">取消绘制</Button>
    </template>

    <!-- ── 状态3：列表态 ── -->
    <template v-if="!store.isDrawing && store.hasShapes">
      <div class="action-bar">
        <Button type="primary" block @click="activeDrawMenu = !activeDrawMenu">
          <PlusCircleOutlined />
          新建形状
        </Button>
        <div v-if="activeDrawMenu" class="draw-menu">
          <Button
            size="small"
            @click="
              store.startDraw('circle');
              activeDrawMenu = false;
            "
          >
            <span class="shape-icon">&#9679;</span> 圆形
          </Button>
          <Button
            size="small"
            @click="
              store.startDraw('rectangle');
              activeDrawMenu = false;
            "
          >
            <span class="shape-icon">&#9632;</span> 矩形
          </Button>
        </div>
        <Button danger block style="margin-top: 8px" @click="store.clearAll()">
          <DeleteOutlined />
          清空全部
        </Button>
      </div>

      <!-- 圆形列表 -->
      <div v-if="store.circles.length > 0" class="shape-section">
        <h4 class="section-title">圆形 ({{ store.circles.length }})</h4>
        <div v-for="circle in store.circles" :key="circle.id" class="shape-card">
          <div class="card-header">
            <span class="card-name">{{ circle.name }}</span>
            <span class="card-color" :style="{ background: circle.color }"></span>
          </div>
          <div class="card-info">
            <div class="info-row">
              <span>圆心</span>
              <span>{{ circle.center[0].toFixed(4) }}, {{ circle.center[1].toFixed(4) }}</span>
            </div>
            <div class="info-row">
              <span>半径</span>
              <span>{{ formatDist(circle.radius) }}</span>
            </div>
            <div class="info-row">
              <span>周长</span>
              <span>{{ formatDist(2 * Math.PI * circle.radius) }}</span>
            </div>
            <div class="info-row">
              <span>面积</span>
              <span>{{ formatArea(Math.PI * circle.radius * circle.radius) }}</span>
            </div>
          </div>
          <div class="card-actions">
            <Button size="small" aria-label="定位到圆形" @click="store.flyTo('geoCircle', circle.id)">
              <AimOutlined />
            </Button>
            <Button
              size="small"
              :aria-label="circle.visible ? '隐藏圆形' : '显示圆形'"
              @click="store.toggleVisibility('geoCircle', circle.id)"
            >
              <EyeOutlined v-if="circle.visible" />
              <EyeInvisibleOutlined v-else />
            </Button>
            <a-popconfirm title="确定删除此圆形？" @confirm="store.removeCircle(circle.id)">
              <Button size="small" danger aria-label="删除圆形">
                <DeleteOutlined />
              </Button>
            </a-popconfirm>
          </div>
        </div>
      </div>

      <!-- 矩形列表 -->
      <div v-if="store.rectangles.length > 0" class="shape-section">
        <h4 class="section-title">矩形 ({{ store.rectangles.length }})</h4>
        <div v-for="rect in store.rectangles" :key="rect.id" class="shape-card">
          <div class="card-header">
            <span class="card-name">{{ rect.name }}</span>
            <span class="card-color" :style="{ background: rect.color }"></span>
          </div>
          <div class="card-info">
            <div class="info-row">
              <span>范围</span>
              <span
                >{{ rect.west.toFixed(4) }}, {{ rect.south.toFixed(4) }} ~ {{ rect.east.toFixed(4) }},
                {{ rect.north.toFixed(4) }}</span
              >
            </div>
            <div class="info-row">
              <span>宽度</span>
              <span>{{ formatDist(getRectSize(rect).width) }}</span>
            </div>
            <div class="info-row">
              <span>高度</span>
              <span>{{ formatDist(getRectSize(rect).height) }}</span>
            </div>
            <div class="info-row">
              <span>面积</span>
              <span>{{ formatArea(getRectSize(rect).width * getRectSize(rect).height) }}</span>
            </div>
          </div>
          <div class="card-actions">
            <Button size="small" aria-label="定位到矩形" @click="store.flyTo('geoRectangle', rect.id)">
              <AimOutlined />
            </Button>
            <Button
              size="small"
              :aria-label="rect.visible ? '隐藏矩形' : '显示矩形'"
              @click="store.toggleVisibility('geoRectangle', rect.id)"
            >
              <EyeOutlined v-if="rect.visible" />
              <EyeInvisibleOutlined v-else />
            </Button>
            <a-popconfirm title="确定删除此矩形？" @confirm="store.removeRectangle(rect.id)">
              <Button size="small" danger aria-label="删除矩形">
                <DeleteOutlined />
              </Button>
            </a-popconfirm>
          </div>
        </div>
      </div>
    </template>
  </SidePanel>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { Button } from 'ant-design-vue';
import {
  PlusCircleOutlined,
  DeleteOutlined,
  AimOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
} from '@ant-design/icons-vue';
import { SidePanel } from '.';
import { useGeoShapeStore } from '@/stores/geoShapeStore';
import { formatArea, formatDist, calcGeoRectangleSize } from '@/utils/cesium/shared/common';

defineOptions({ name: 'GeoShape' });

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();

const store = useGeoShapeStore();
const activeDrawMenu = ref(false);

// 面板关闭时关闭绘制菜单
watch(
  () => props.visible,
  (v) => {
    if (!v) activeDrawMenu.value = false;
  },
);

/** 缓存矩形尺寸计算（同一矩形在一次渲染中宽度/高度/面积共用） */
function getRectSize(rect: { west: number; south: number; east: number; north: number }) {
  return calcGeoRectangleSize(rect);
}
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hint {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  text-align: center;
}

.hint-detail {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 12px;
  line-height: 1.8;
  text-align: center;
}

kbd {
  padding: 1px 4px;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  background: var(--color-bg-elevated);
  font-size: 11px;
}

.shape-icon {
  margin-right: 4px;
  font-size: 14px;
}

.drawing-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.drawing-name {
  font-size: 15px;
  font-weight: 600;
}

.live-measure {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
  padding: 9px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-elevated);
}

.measure-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.measure-label {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.measure-value {
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 600;
}

.instructions {
  margin-bottom: 16px;
}

.instructions p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.highlight {
  color: var(--color-primary);
  font-weight: 500;
}

.action-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.draw-menu {
  display: flex;
  gap: 8px;
  padding: 8px 0;
}

.shape-section {
  margin-top: 16px;
}

.section-title {
  margin: 0 0 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
}

.shape-card {
  margin-bottom: 8px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-elevated);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.card-name {
  font-size: 14px;
  font-weight: 600;
}

.card-color {
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-border);
  border-radius: 50%;
}

.card-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
