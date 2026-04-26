<!--
  components/Cesium/GeoPath.vue —— 地质路径规划测量面板
  支持多路径绘制、距离测量、高程剖面分析、GeoJSON 导出
-->
<template>
  <SidePanel :visible="visible" title="地质路径" @update:visible="emit('update:visible', $event)">
    <!-- ── 状态1：空闲 ── -->
    <template v-if="!store.isDrawing && !store.hasPaths">
      <div class="empty-state">
        <Input v-model:value="drawName" placeholder="路径名称（选填）" allow-clear />
        <Button type="primary" block @click="handleStartDraw">
          <SwapOutlined />
          开始绘制路径
        </Button>
        <p class="hint">点击后在地图上左键添加路径点，右键完成绘制</p>
        <Button block @click="triggerImport">
          <UploadOutlined />
          导入 GeoJSON
        </Button>
      </div>
    </template>

    <!-- ── 状态2：绘制中 ── -->
    <template v-if="store.isDrawing">
      <div class="drawing-header">
        <span class="drawing-name">{{ activePathName }}</span>
      </div>
      <div class="drawing-info">
        <div class="info-row">
          <span class="info-label">路径点</span>
          <span class="info-value">{{ store.positions.length }}</span>
        </div>
        <div v-if="liveTotal > 0" class="info-row">
          <span class="info-label">实时距离</span>
          <span class="info-value highlight">{{ liveTotal.toFixed(1) }} m</span>
        </div>
      </div>
      <div class="instructions">
        <p>左键点击添加路径点</p>
        <p>鼠标移动预览下一段</p>
        <p>右键 / Enter 完成绘制</p>
        <p>Backspace 撤销末点 / Escape 取消</p>
      </div>
      <Button danger block @click="store.cancelDraw()">
        <CloseOutlined />
        取消绘制
      </Button>
    </template>

    <!-- ── 状态3：路径列表 ── -->
    <template v-if="!store.isDrawing && store.hasPaths">
      <div class="paths-actions">
        <Button size="small" @click="resetDraw">
          <PlusOutlined />
          新建路径
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

      <div class="paths-scroll">
        <div
          v-for="path in store.paths"
          :key="path.id"
          class="path-card"
          :class="{ active: path.id === store.activePathId }"
          @click="store.selectPath(path.id)"
        >
          <div class="path-header">
            <div class="path-info">
              <span class="color-dot" :style="{ backgroundColor: path.color }"></span>
              <span class="path-name" :title="path.name">{{ path.name }}</span>
            </div>
            <div class="path-actions">
              <Tooltip title="飞行定位">
                <Button type="text" size="small" class="action-btn" @click.stop="store.flyToPath(path.id)">
                  <AimOutlined />
                </Button>
              </Tooltip>
              <Tooltip :title="path.show ? '隐藏' : '显示'">
                <Button type="text" size="small" class="action-btn" @click.stop="store.toggleVisibility(path.id)">
                  <EyeOutlined v-if="path.show" />
                  <EyeInvisibleOutlined v-else />
                </Button>
              </Tooltip>
              <Popconfirm title="确认删除该路径？" placement="topRight" @confirm.stop="store.removePath(path.id)">
                <Button type="text" danger size="small" class="action-btn" @click.stop>
                  <DeleteOutlined />
                </Button>
              </Popconfirm>
              <Tooltip title="编辑顶点">
                <Button type="text" size="small" class="action-btn" @click.stop="store.startEdit(path.id)">
                  <EditOutlined />
                </Button>
              </Tooltip>
            </div>
          </div>

          <!-- 展开详情 -->
          <div v-if="path.id === store.activePathId" class="path-detail">
            <div class="detail-section">
              <div class="detail-title">距离测量</div>
              <div class="total-row">
                <span class="total-label">总距离</span>
                <span class="total-value">{{ path.measurements.total.toFixed(1) }} m</span>
              </div>
              <div v-if="path.measurements.segments.length" class="segments-list">
                <div v-for="(seg, i) in path.measurements.segments" :key="i" class="segment-row">
                  <span class="seg-label">{{ formatSegLabel(i) }}</span>
                  <span class="seg-value">{{ seg.toFixed(1) }} m</span>
                </div>
              </div>
            </div>

            <!-- 高程剖面 -->
            <div v-if="path.elevationProfile" class="detail-section">
              <div class="detail-title">高程剖面</div>
              <svg
                class="profile-chart"
                :viewBox="`0 0 ${chartW} ${chartH}`"
                preserveAspectRatio="none"
              >
                <!-- 坐标轴 -->
                <line :x1="padL" :y1="0" :x2="padL" :y2="chartH - padB" stroke="#888" stroke-width="1" />
                <line :x1="padL" :y1="chartH - padB" :x2="chartW" :y2="chartH - padB" stroke="#888" stroke-width="1" />
                <!-- 剖面线 -->
                <polyline
                  :points="profilePoints(path.elevationProfile)"
                  fill="none"
                  stroke="#1890ff"
                  stroke-width="2"
                />
                <!-- 填充区域 -->
                <polygon
                  :points="profileArea(path.elevationProfile)"
                  fill="rgba(24,144,255,0.1)"
                />
              </svg>

              <div class="profile-stats">
                <div class="stat">
                  <span class="stat-label">最低</span>
                  <span class="stat-value">{{ path.elevationProfile.minElevation.toFixed(0) }} m</span>
                </div>
                <div class="stat">
                  <span class="stat-label">最高</span>
                  <span class="stat-value">{{ path.elevationProfile.maxElevation.toFixed(0) }} m</span>
                </div>
                <div class="stat">
                  <span class="stat-label">平均</span>
                  <span class="stat-value">{{ path.elevationProfile.avgElevation.toFixed(0) }} m</span>
                </div>
                <div class="stat">
                  <span class="stat-label">爬升</span>
                  <span class="stat-value">{{ path.elevationProfile.totalClimb.toFixed(0) }} m</span>
                </div>
                <div class="stat">
                  <span class="stat-label">下降</span>
                  <span class="stat-value">{{ path.elevationProfile.totalDescent.toFixed(0) }} m</span>
                </div>
                <div class="stat">
                  <span class="stat-label">坡度</span>
                  <span class="stat-value">{{ path.elevationProfile.avgGradient.toFixed(1) }}%</span>
                </div>
              </div>
            </div>

            <!-- 剖面加载中 -->
            <div v-else-if="store.profileLoading" class="detail-section">
              <div class="detail-title">高程剖面</div>
              <div class="loading-hint">正在采样地形高程...</div>
            </div>

            <!-- 剖面不可用（编辑后清空或初始采样失败），提供重新采样 -->
            <div v-else class="detail-section">
              <div class="detail-title">高程剖面</div>
              <Button size="small" @click.stop="store.resampleProfile(path.id)">
                <ReloadOutlined />
                重新采样
              </Button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ── 状态4：编辑中 ── -->
    <template v-if="store.isEditing">
      <Button type="primary" block @click="store.stopEdit()">
        <CheckOutlined />
        完成编辑
      </Button>
      <div class="edit-toolbar">
        <Button size="small" :disabled="!store.canUndo" @click="store.undo()">撤销</Button>
        <Button size="small" :disabled="!store.canRedo" @click="store.redo()">重做</Button>
      </div>
      <div class="editing-tip">
        拖动顶点调整形状 · 点击线段添加顶点 · 右键顶点删除<br />
        <kbd>Delete</kbd> 选中删除 · <kbd>Ctrl+Z</kbd> 撤销 · <kbd>Esc</kbd> 退出<br />
        <span class="camera-lock-hint">编辑期间相机已锁定</span>
      </div>
      <div class="vertex-count">共 {{ store.positions.length }} 个顶点</div>
    </template>
  </SidePanel>
  <input ref="fileInput" type="file" accept=".geojson,.json" hidden @change="handleFileImport" />
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { Button, Input, Tooltip, Popconfirm, message } from 'ant-design-vue';
import {
  SwapOutlined,
  CloseOutlined,
  PlusOutlined,
  DownloadOutlined,
  UploadOutlined,
  AimOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  DeleteOutlined,
  EditOutlined,
  CheckOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';
import SidePanel from './SidePanel.vue';
import { useGeoPathStore } from '@/stores/geoPathStore';
import type { ElevationProfile } from '@/types/geoPath';
import { calcPathDistances } from '@/utils/cesium/usePathMeasure';

defineOptions({ name: 'GeoPath' });

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();

const store = useGeoPathStore();

/* ── 路径创建 ── */
const drawName = ref('');

function resetDraw() {
  drawName.value = '';
  store.startDraw('general');
}

function handleStartDraw() {
  store.startDraw('general');
  // 如果用户填了名称，替换默认名
  if (drawName.value.trim()) {
    const path = store.activePath;
    if (path) path.name = drawName.value.trim();
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
const liveTotal = ref(0);
const activePathName = ref('');

watch(
  () => store.positions.length,
  () => {
    if (store.positions.length >= 2) {
      const result = calcPathDistances(store.positions);
      liveTotal.value = result.total;
    } else {
      liveTotal.value = 0;
    }
  },
);

watch(
  () => store.activePath,
  (p) => {
    if (p && store.isDrawing) {
      activePathName.value = p.name;
    }
  },
  { immediate: true },
);

function formatSegLabel(index: number) {
  return `${index + 1} → ${index + 2}`;
}

/* ── SVG 剖面图 ── */
const chartW = 320;
const chartH = 150;
const padL = 30;
const padB = 20;
const plotW = chartW - padL;
const plotH = chartH - padB;

function profilePoints(profile: ElevationProfile): string {
  const { distances, elevations } = profile;
  if (distances.length < 2) return '';
  const maxD = distances[distances.length - 1] || 1;
  let minE = profile.minElevation;
  let maxE = profile.maxElevation;
  const range = Math.max(maxE - minE, 1);
  // 上下各留 10% 边距
  const padding = range * 0.1;
  minE -= padding;
  maxE += padding;
  const hRange = maxE - minE;

  return distances
    .map((d, i) => {
      const x = padL + (d / maxD) * plotW;
      const y = chartH - padB - ((elevations[i] - minE) / hRange) * plotH;
      return `${x},${y}`;
    })
    .join(' ');
}

function profileArea(profile: ElevationProfile): string {
  const { distances } = profile;
  if (distances.length < 2) return '';
  const points = profilePoints(profile);
  const lastX = padL + plotW;
  const bottomY = chartH - padB;
  return `${padL},${bottomY} ${points} ${lastX},${bottomY}`;
}

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

.profile-chart {
  width: 100%;
  height: 120px;
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  background: var(--surface-bg-secondary, var(--surface-bg));
}

.profile-stats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 4px;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 2px;
  border: 1px solid var(--surface-border);
  border-radius: 4px;
}

.stat-label {
  color: var(--surface-text-muted);
  font-size: 11px;
}

.stat-value {
  color: var(--color-text);
  font-size: 12px;
  font-weight: 500;
}

.loading-hint {
  padding: 12px;
  color: var(--surface-text-muted);
  font-size: 12px;
  text-align: center;
}

.edit-toolbar {
  display: flex;
  gap: 8px;
}

.editing-tip {
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.editing-tip kbd {
  display: inline-block;
  margin: 0 1px;
  padding: 1px 5px;
  border: 1px solid var(--panel-border);
  border-radius: 3px;
  background: var(--panel-surface);
  font-family: inherit;
  font-size: 11px;
}

.vertex-count {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.camera-lock-hint {
  display: inline-block;
  margin-top: 4px;
  color: var(--warning-color, #faad14);
  font-size: 11px;
}
</style>

