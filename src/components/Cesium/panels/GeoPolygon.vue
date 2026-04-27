<!--
  components/Cesium/GeoPolygon.vue —— 多边形地质勘测面板
  支持多边行绘制、面积/周长测量、GeoJSON 导出
-->
<template>
  <SidePanel :visible="visible" title="多边形勘测" @update:visible="emit('update:visible', $event)">
    <!-- ── 状态1：空闲 ── -->
    <template v-if="!store.isDrawing && !store.hasPolygons">
      <div class="empty-state">
        <Input v-model:value="drawName" placeholder="多边形名称（选填）" allow-clear />
        <Button type="primary" block @click="handleStartDraw">
          <AuditOutlined />
          开始绘制多边形
        </Button>
        <p class="hint">点击后在地图上左键添加顶点，右键完成绘制（至少 3 个顶点）</p>
        <Button block @click="triggerImport">
          <UploadOutlined />
          导入 GeoJSON
        </Button>
      </div>
    </template>

    <!-- ── 状态2：绘制中 ── -->
    <template v-if="store.isDrawing">
      <div class="drawing-header">
        <span class="drawing-name">{{ activePolyName }}</span>
      </div>
      <div class="drawing-info">
        <div class="info-row">
          <span class="info-label">顶点</span>
          <span class="info-value">{{ store.positions.length }}</span>
        </div>
        <div v-if="store.positions.length >= 2" class="info-row">
          <span class="info-label">实时周长</span>
          <span class="info-value highlight">{{ livePerimeter }}</span>
        </div>
        <div v-if="store.positions.length >= 3" class="info-row">
          <span class="info-label">实时面积</span>
          <span class="info-value highlight">{{ liveArea }}</span>
        </div>
      </div>
      <div class="instructions">
        <p>左键点击添加顶点</p>
        <p>鼠标移动预览闭合</p>
        <p>右键 / Enter 完成绘制</p>
        <p>Backspace 撤销末点 / Escape 取消</p>
      </div>
      <Button danger block @click="store.cancelDraw()">
        <CloseOutlined />
        取消绘制
      </Button>
    </template>

    <!-- ── 状态3：多边形列表 ── -->
    <template v-if="!store.isDrawing && store.hasPolygons">
      <div class="paths-actions">
        <Button size="small" @click="resetDraw">
          <PlusOutlined />
          新建多边形
        </Button>
        <Button size="small" @click="store.downloadGeoJson()">
          <DownloadOutlined />
          导出
        </Button>
        <Button size="small" @click="triggerImport">
          <UploadOutlined />
          导入
        </Button>
      </div>

      <!-- 汇总统计 -->
      <div v-if="store.polygonStats" class="stats-bar">
        <span class="stat-item">{{ store.polygonStats.count }} 个多边形</span>
        <span class="stat-item">总面积 {{ formatArea(store.polygonStats.totalArea) }}</span>
        <span class="stat-item">平均 {{ formatArea(store.polygonStats.avgArea) }}</span>
      </div>

      <div class="paths-scroll">
        <div v-for="poly in store.polygons" :key="poly.id" class="path-card"
          :class="{ active: poly.id === store.activePolygonId }" @click="store.selectPolygon(poly.id)">
          <div class="path-header">
            <div class="path-info">
              <span class="color-dot" :style="{ backgroundColor: poly.color }"></span>
              <span class="path-name" :title="poly.name">{{ poly.name }}</span>
            </div>
            <div class="path-actions">
              <Tooltip title="飞行定位">
                <Button type="text" size="small" class="action-btn" @click.stop="store.flyToPolygon(poly.id)">
                  <AimOutlined />
                </Button>
              </Tooltip>
              <Tooltip :title="poly.show ? '隐藏' : '显示'">
                <Button type="text" size="small" class="action-btn" @click.stop="store.toggleVisibility(poly.id)">
                  <EyeOutlined v-if="poly.show" />
                  <EyeInvisibleOutlined v-else />
                </Button>
              </Tooltip>
              <Popconfirm title="确认删除该多边形？" placement="topRight" @confirm.stop="store.removePolygon(poly.id)">
                <Button type="text" danger size="small" class="action-btn" @click.stop>
                  <DeleteOutlined />
                </Button>
              </Popconfirm>
              <Tooltip title="编辑顶点">
                <Button type="text" size="small" class="action-btn" @click.stop="store.startEdit(poly.id)">
                  <EditOutlined />
                </Button>
              </Tooltip>
            </div>
          </div>

          <!-- 展开详情 -->
          <div v-if="poly.id === store.activePolygonId" class="path-detail">
            <div class="detail-section">
              <div class="detail-title">测量结果</div>
              <div class="total-row">
                <span class="total-label">面积</span>
                <span class="total-value">{{ formatArea(poly.measurements.area) }}</span>
              </div>
              <div class="total-row">
                <span class="total-label">周长</span>
                <span class="total-value">{{ formatDist(poly.measurements.perimeter) }}</span>
              </div>
              <div v-if="poly.measurements.segments.length" class="segments-list">
                <div v-for="(seg, i) in poly.measurements.segments" :key="i" class="segment-row">
                  <span class="seg-label">边 {{ i + 1 }}</span>
                  <span class="seg-value">{{ seg.toFixed(1) }} m</span>
                </div>
              </div>
            </div>

            <!-- 顶点坐标 -->
            <VertexTable :vertices="store.vertexData" />

            <!-- ── 坡度分析 ── -->
            <SlopeAnalysis :result="store.slopeResult" :loading="store.slopeLoading" :show-grid="store.showSlopeGrid"
              @analyze="store.analyzeSlope(poly.id)" @toggle-grid="store.toggleSlopeGrid()"
              @reanalyze="store.analyzeSlope(poly.id)" />

            <!-- 工具按钮 -->
            <div class="detail-tools">
              <Tooltip title="裁切模式下显示多边形外部">
                <Button size="small" :type="store.clippingInverse ? 'primary' : 'default'"
                  :disabled="!poly.clipping" :danger="store.clippingInverse"
                  @click.stop="store.toggleClippingInverse()">
                  {{ store.clippingInverse ? '反选中' : '反选' }}
                </Button>
              </Tooltip>
              <Tooltip title="以该多边形形状裁切地形">
                <Button size="small" :type="poly.clipping ? 'primary' : 'default'" :danger="poly.clipping"
                  @click.stop="store.toggleClipping(poly.id)">
                  <template v-if="poly.clipping">裁切中</template>
                  <template v-else>地形裁切</template>
                </Button>
              </Tooltip>
              <Tooltip :title="store.showLabels ? '隐藏标注' : '显示标注'">
                <Button size="small" @click.stop="store.toggleLabels()">
                  <TagsOutlined v-if="store.showLabels" />
                  <TagsFilled v-else />
                  {{ store.showLabels ? '隐藏标注' : '显示标注' }}
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </template>

    <EditToolbar :visible="store.isEditing" :can-undo="store.canUndo" :can-redo="store.canRedo" :vertex-count="store.positions.length" @finish="store.stopEdit()" @undo="store.undo()" @redo="store.redo()" />
  </SidePanel>
  <input ref="fileInput" type="file" accept=".geojson,.json" hidden @change="handleFileImport" />
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { Button, Input, Tooltip, Popconfirm, message } from 'ant-design-vue';
import {
  AuditOutlined,
  CloseOutlined,
  PlusOutlined,
  DownloadOutlined,
  UploadOutlined,
  AimOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  DeleteOutlined,
  EditOutlined,
  TagsOutlined,
  TagsFilled,
} from '@ant-design/icons-vue';
import SidePanel from './SidePanel.vue';
import VertexTable from '../shared/VertexTable.vue';
import SlopeAnalysis from '../shared/SlopeAnalysis.vue';
import EditToolbar from '../shared/EditToolbar.vue';
import { useGeoPolygonStore, formatArea, formatDist } from '@/stores/geoPolygonStore';
import { calcPolygonMeasure } from '@/utils/cesium/usePolygonDrawing';

defineOptions({ name: 'GeoPolygon' });

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();

const store = useGeoPolygonStore();

/* ── 多边形创建 ── */
const drawName = ref('');

function resetDraw() {
  drawName.value = '';
  store.startDraw();
}

function handleStartDraw() {
  store.startDraw();
  if (drawName.value.trim()) {
    const poly = store.activePolygon;
    if (poly) poly.name = drawName.value.trim();
  }
}

/* ── GeoJSON 导入 ── */
const fileInput = ref<HTMLInputElement | null>(null);

function triggerImport() {
  fileInput.value?.click();
}

function handleFileImport(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string);
      store.importFromGeoJson(data);
    } catch {
      message.error('文件格式错误，请上传有效的 GeoJSON 文件');
    }
  };
  reader.readAsText(file);
  target.value = '';
}

/* ── 绘制中实时信息 ── */
const livePerimeter = ref('');
const liveArea = ref('');
const activePolyName = ref('');

watch(
  () => store.positions.length,
  () => {
    if (store.positions.length >= 2) {
      const result = calcPolygonMeasure(store.positions);
      livePerimeter.value = formatDist(result.perimeter);
      if (store.positions.length >= 3) {
        liveArea.value = formatArea(result.area);
      } else {
        liveArea.value = '';
      }
    } else {
      livePerimeter.value = '';
      liveArea.value = '';
    }
  },
);

watch(
  () => store.activePolygon,
  (p) => {
    if (p && store.isDrawing) {
      activePolyName.value = p.name;
    }
  },
  { immediate: true },
);

/* ── 组件卸载时清理 ── */
onUnmounted(() => {
  if (store.isEditing) store.stopEdit();
  else if (store.isDrawing) store.cancelDraw();
});
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hint {
  margin: 0;
  color: var(--surface-text-muted);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}

.drawing-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.drawing-name {
  flex: 1;
  overflow: hidden;
  color: var(--color-text);
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawing-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  background: var(--surface-bg-secondary, var(--surface-bg));
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.info-label {
  color: var(--surface-text-muted);
  font-size: 12px;
}

.info-value {
  font-size: 13px;
  font-weight: 500;
}

.info-value.highlight {
  color: var(--primary-color, #1890ff);
  font-size: 15px;
  font-weight: 600;
}

.instructions {
  padding: 8px 10px;
  border: 1px dashed var(--surface-border);
  border-radius: 6px;
  background: var(--surface-bg-secondary, var(--surface-bg));
}

.instructions p {
  margin: 2px 0;
  color: var(--surface-text-muted);
  font-size: 12px;
}

.paths-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.paths-scroll {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 400px;
  overflow-y: auto;
}

.path-card {
  display: flex;
  flex-direction: column;
  padding: 8px 10px;
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  background: var(--surface-bg);
  cursor: pointer;
  transition: all 0.2s;
}

.path-card:hover {
  border-color: var(--primary-color, #1890ff);
}

.path-card.active {
  border-color: var(--primary-color, #1890ff);
  background: var(--surface-bg-active, color-mix(in srgb, var(--primary-color, #1890ff) 5%, transparent));
}

.path-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.path-info {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.color-dot {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.path-name {
  overflow: hidden;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--surface-text-muted);
  font-size: 13px;
}

.action-btn:hover {
  color: var(--color-text);
}

.path-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--surface-border);
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-title {
  color: var(--surface-text-muted);
  font-size: 12px;
  font-weight: 500;
}

.total-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  background: var(--surface-bg-secondary, var(--surface-bg));
}

.total-label {
  color: var(--surface-text-muted);
  font-size: 12px;
}

.total-value {
  color: var(--primary-color, #1890ff);
  font-size: 16px;
  font-weight: 600;
}

.segments-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.segment-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 8px;
}

.seg-label {
  color: var(--surface-text-muted);
  font-size: 12px;
}

.seg-value {
  color: var(--color-text);
  font-size: 12px;
}


/* ── 汇总统计 ── */
.stats-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 6px 8px;
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  background: var(--surface-bg-secondary, var(--surface-bg));
  font-size: 12px;
  margin-bottom: 8px;
}

.stat-item {
  color: var(--color-text-secondary);
  white-space: nowrap;
}

/* ── 详情工具按钮 ── */
.detail-tools {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
</style>
