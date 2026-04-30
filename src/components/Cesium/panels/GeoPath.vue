<!--
  components/Cesium/GeoPath.vue —— 地质路径规划测量面板
  支持多路径绘制、距离测量、高程剖面分析、GeoJSON 导出
-->
<template>
  <SidePanel
    :visible="visible"
    title="地质路径"
    :disableEscape="store.isDrawing || store.isEditing"
    @update:visible="emit('update:visible', $event)"
  >
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
        <div class="info-row">
          <span class="info-label">吸附</span>
          <div class="snapping-controls">
            <Switch
              v-model:checked="store.snappingEnabled"
              size="small"
              :checked-children="'开'"
              :un-checked-children="'关'"
            />
            <span v-if="store.isSnapping" class="snapping-badge">吸附中</span>
          </div>
        </div>
      </div>
      <div class="instructions">
        <p>左键点击添加路径点</p>
        <p>鼠标移动预览下一段</p>
        <p>右键 / Enter 完成绘制</p>
        <p>Backspace 撤销末点 / Escape 取消</p>
        <p class="snap-hint">按住 Shift 临时禁用吸附</p>
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

      <ListToolbar
        :count="store.paths.length"
        :all-visible="store.paths.length > 0 && store.paths.every((p) => p.show)"
        :search-query="searchQuery"
        search-placeholder="搜索路径"
        item-name="路径"
        @toggle-all-visibility="store.toggleAllVisibility()"
        @remove-all="store.clearAll()"
        @update:search-query="searchQuery = $event"
      />

      <div class="paths-scroll">
        <div
          v-for="path in filteredPaths"
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
                <Button
                  type="text"
                  size="small"
                  class="action-btn"
                  aria-label="飞行定位"
                  @click.stop="store.flyToPath(path.id)"
                >
                  <AimOutlined />
                </Button>
              </Tooltip>
              <Tooltip :title="path.show ? '隐藏' : '显示'">
                <Button
                  type="text"
                  size="small"
                  class="action-btn"
                  :aria-label="path.show ? '隐藏路径' : '显示路径'"
                  @click.stop="store.toggleVisibility(path.id)"
                >
                  <EyeOutlined v-if="path.show" />
                  <EyeInvisibleOutlined v-else />
                </Button>
              </Tooltip>
              <Popconfirm title="确认删除该路径？" placement="topRight" @confirm.stop="store.removePath(path.id)">
                <Button type="text" danger size="small" class="action-btn" aria-label="删除路径" @click.stop>
                  <DeleteOutlined />
                </Button>
              </Popconfirm>
              <Tooltip title="编辑顶点">
                <Button
                  type="text"
                  size="small"
                  class="action-btn"
                  aria-label="编辑顶点"
                  @click.stop="store.startEdit(path.id)"
                >
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

            <ElevationProfile
              :profile="path.elevationProfile"
              :loading="store.profileLoading"
              @resample="store.resampleProfile(path.id)"
            />

            <!-- 顶点坐标 -->
            <VertexTable :vertices="store.vertexData" />

            <!-- ── 轨迹播放 ── -->
            <div class="detail-section">
              <div class="detail-title">轨迹播放</div>
              <template v-if="!store.playbackIsPlaying">
                <Button size="small" type="primary" @click.stop="store.startPlayback(path)">
                  <CaretRightOutlined />
                  播放轨迹
                </Button>
              </template>
              <template v-else>
                <div class="playback-info-row">
                  <span
                    >已行驶 {{ store.playbackDistance.toFixed(1) }} / {{ path.measurements.total.toFixed(1) }} m</span
                  >
                </div>
                <div class="playback-info-row">
                  <span
                    >{{ formatTime(store.playbackDuration) }} / {{ formatTime(store.playbackEstimatedDuration) }}</span
                  >
                </div>
                <Slider
                  :min="0"
                  :max="1"
                  :step="0.001"
                  :value="store.playbackProgress"
                  class="playback-slider"
                  @change="(v: any) => store.seekPlayback(v as number)"
                />
                <div class="playback-btns">
                  <Button size="small" @click="store.seekPlayback(0)">
                    <FastBackwardOutlined />
                  </Button>
                  <Button size="small" type="primary" @click="togglePlayPause">
                    <PauseOutlined v-if="!store.playbackIsPaused" />
                    <CaretRightOutlined v-else />
                  </Button>
                  <Button size="small" @click="store.stopPlayback()">
                    <StopOutlined />
                  </Button>
                </div>
                <div class="playback-follow">
                  <Button
                    size="small"
                    :type="store.playbackFollowCamera ? 'primary' : 'default'"
                    @click="store.togglePlaybackFollowCamera()"
                  >
                    <AimOutlined />
                    {{ store.playbackFollowCamera ? '视角跟随中' : '视角跟随' }}
                  </Button>
                </div>
                <div class="playback-speed">
                  <span class="pb-label">速度</span>
                  <div class="pb-btn-group">
                    <Button
                      :type="store.playbackSpeed === 0.5 ? 'primary' : 'default'"
                      size="small"
                      @click="store.setPlaybackSpeed(0.5)"
                      >0.5x</Button
                    >
                    <Button
                      :type="store.playbackSpeed === 1 ? 'primary' : 'default'"
                      size="small"
                      @click="store.setPlaybackSpeed(1)"
                      >1x</Button
                    >
                    <Button
                      :type="store.playbackSpeed === 2 ? 'primary' : 'default'"
                      size="small"
                      @click="store.setPlaybackSpeed(2)"
                      >2x</Button
                    >
                    <Button
                      :type="store.playbackSpeed === 4 ? 'primary' : 'default'"
                      size="small"
                      @click="store.setPlaybackSpeed(4)"
                      >4x</Button
                    >
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </template>

    <EditToolbar
      :visible="store.isEditing"
      :can-undo="store.canUndo"
      :can-redo="store.canRedo"
      :vertex-count="store.positions.length"
      v-model:link-edit-enabled="store.linkEditEnabled"
      @finish="store.stopEdit()"
      @undo="store.undo()"
      @redo="store.redo()"
    />
  </SidePanel>
  <input ref="fileInput" type="file" accept=".geojson,.json" hidden @change="handleFileImport" />
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { Button, Input, Slider, Switch, Tooltip, Popconfirm, message } from 'ant-design-vue';
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
  CaretRightOutlined,
  PauseOutlined,
  StopOutlined,
  FastBackwardOutlined,
} from '@ant-design/icons-vue';
import { SidePanel } from '.';
import { ElevationProfile, ListToolbar, VertexTable, EditToolbar } from '../shared';
import { useGeoPathStore } from '@/stores/geoPathStore';
import { useListSearch } from '@/utils/useListSearch';
import { calcPathDistances } from '@/utils/cesium/path/usePathMeasure';

defineOptions({ name: 'GeoPath' });

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();

const store = useGeoPathStore();

/* ── 搜索过滤 ── */
const { searchQuery, filteredItems: filteredPaths } = useListSearch(computed(() => store.paths));

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

/* ── 组件卸载时清理 ── */
onUnmounted(() => {
  if (store.playbackIsPlaying) store.stopPlayback();
  if (store.isEditing) store.stopEdit();
  else if (store.isDrawing) store.cancelDraw();
});

/* ── 轨迹播放辅助 ── */

function togglePlayPause() {
  if (store.playbackIsPaused) store.resumePlayback();
  else store.pausePlayback();
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

.snapping-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.snapping-badge {
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--primary-color, #1890ff);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
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

.snap-hint {
  margin-top: 4px;
  color: var(--primary-color, #1890ff);
  font-size: 11px;
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

/* ── 轨迹播放 ── */

.playback-info-row {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text);
  font-size: 12px;
}

.playback-slider {
  margin: 0 4px;
}

.playback-btns {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.playback-speed {
  display: flex;
  align-items: center;
  gap: 6px;
}

.playback-follow {
  display: flex;
  justify-content: center;
}

.pb-label {
  flex-shrink: 0;
  width: 32px;
  color: var(--surface-text-muted);
  font-size: 12px;
}

.pb-btn-group {
  display: flex;
  flex: 1;
  gap: 4px;
}

.pb-btn-group .ant-btn {
  flex: 1;
  padding: 0 4px;
  font-size: 11px;
}

/* 状态切换淡入动画 */
.empty-state,
.drawing-header,
.drawing-info,
.instructions,
.paths-actions,
.paths-scroll {
  animation: fade-in 0.2s ease;
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
