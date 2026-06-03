<!--
  components/Cesium/panels/FlightTrack.vue —— DJI 飞行轨迹面板
  加载 frames.json，解析并在 Cesium 中显示飞行轨迹、姿态与云台状态
-->
<template>
  <SidePanel :visible="visible" title="飞行轨迹" @update:visible="emit('update:visible', $event)">
    <!-- ── 状态1：无轨迹 ── -->
    <template v-if="!store.hasTracks">
      <div class="empty-state">
        <p class="hint">加载 DJI 飞行记录文件（frames.json）</p>
        <Button type="primary" block :loading="store.isLoading" @click="triggerFileLoad">
          <UploadOutlined />
          选择文件加载
        </Button>
        <Button block :loading="store.isLoading" @click="loadDefault">
          <RocketOutlined />
          加载示例数据
        </Button>
      </div>
    </template>

    <!-- ── 状态2：轨迹列表 ── -->
    <template v-if="store.hasTracks">
      <!-- 轨迹卡片列表 -->
      <div class="tracks-list">
        <div v-for="track in store.tracks" :key="track.id" class="track-card"
          :class="{ active: track.id === store.activeTrackId }" @click="store.selectTrack(track.id)">
          <div class="track-header">
            <div class="track-info">
              <RocketOutlined class="track-icon" />
              <span class="track-name">{{ track.name }}</span>
            </div>
            <div class="track-actions">
              <Tooltip title="飞行定位">
                <Button type="text" size="small" class="action-btn" aria-label="飞行定位"
                  @click.stop="store.flyToTrack(track.id)">
                  <AimOutlined />
                </Button>
              </Tooltip>
              <Tooltip :title="track.show ? '隐藏' : '显示'">
                <Button type="text" size="small" class="action-btn" :aria-label="track.show ? '隐藏轨迹' : '显示轨迹'"
                  @click.stop="store.toggleVisibility(track.id)">
                  <EyeOutlined v-if="track.show" />
                  <EyeInvisibleOutlined v-else />
                </Button>
              </Tooltip>
              <Popconfirm title="确认删除该轨迹？" placement="topRight" @confirm.stop="store.removeTrack(track.id)">
                <Button type="text" danger size="small" class="action-btn" aria-label="删除轨迹" @click.stop>
                  <DeleteOutlined />
                </Button>
              </Popconfirm>
            </div>
          </div>

          <!-- 基本信息 -->
          <div class="track-stats">
            <div class="stat-item">
              <span class="stat-label">帧数</span>
              <span class="stat-value">{{ track.frames.length }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">时长</span>
              <span class="stat-value">{{ formatTime(track.totalTime) }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">距离</span>
              <span class="stat-value">{{ formatDist(track.totalDistance) }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">最大高度</span>
              <span class="stat-value">{{ track.maxHeight.toFixed(1) }} m</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">最大速度</span>
              <span class="stat-value">{{ track.maxSpeed.toFixed(1) }} m/s</span>
            </div>
          </div>

          <!-- 展开详情：播放控制 + 帧数据 -->
          <div v-if="track.id === store.activeTrackId" class="track-detail">
            <!-- 播放控制 -->
            <div class="playback-section">
              <div class="detail-title">轨迹回放</div>

              <template v-if="!store.playback.isPlaying">
                <Button size="small" type="primary" block @click.stop="store.startPlayback(track.id)">
                  <CaretRightOutlined />
                  开始回放
                </Button>
              </template>

              <template v-else>
                <div class="playback-progress">
                  <span class="pb-time">{{ formatTime(store.playback.currentTime) }}</span>
                  <Slider :min="0" :max="1" :step="0.001" :value="store.playback.progress" size="small"
                    @change="(v: any) => store.seekPlayback(v as number)" />
                  <span class="pb-time">{{ formatTime(track.totalTime) }}</span>
                </div>

                <div class="playback-controls">
                  <Button size="small" @click.stop="store.seekPlayback(0)">
                    <FastBackwardOutlined />
                  </Button>
                  <Button size="small" type="primary" @click.stop="togglePlayPause">
                    <PauseOutlined v-if="!store.playback.isPaused" />
                    <CaretRightOutlined v-else />
                  </Button>
                  <Button size="small" danger @click.stop="store.stopPlayback()">
                    <StopOutlined />
                  </Button>
                </div>

                <div class="playback-options">
                  <Button size="small" :type="store.playbackFollowCamera ? 'primary' : 'default'"
                    @click.stop="store.togglePlaybackFollowCamera()">
                    <AimOutlined />
                    {{ store.playbackFollowCamera ? '视角跟随' : '自由视角' }}
                  </Button>
                  <div class="speed-btns">
                    <Button v-for="s in [0.5, 1, 2, 4]" :key="s" size="small"
                      :type="store.playbackSpeed === s ? 'primary' : 'default'" @click.stop="store.setPlaybackSpeed(s)">
                      {{ s }}x
                    </Button>
                  </div>
                </div>
              </template>
            </div>

            <!-- 轨迹分析 -->
            <FlightTrackAnalysis :frames="track.frames" :total-time="track.totalTime" />

            <!-- 当前帧数据 -->
            <div v-if="currentFrame" class="frame-data">
              <div class="detail-title">
                实时数据
                <span class="frame-index">#{{ store.playback.currentFrameIndex + 1 }} / {{ track.frames.length }}</span>
              </div>

              <!-- 位置与速度 -->
              <div class="data-group">
                <div class="data-row">
                  <span class="data-label">经纬度</span>
                  <span class="data-value">{{ currentFrame.latitude.toFixed(6) }}, {{ currentFrame.longitude.toFixed(6)
                    }}</span>
                </div>
                <div class="data-row">
                  <span class="data-label">相对高度</span>
                  <span class="data-value">{{ currentFrame.height.toFixed(1) }} m</span>
                </div>
                <div class="data-row">
                  <span class="data-label">海拔</span>
                  <span class="data-value">{{ currentFrame.altitude.toFixed(1) }} m</span>
                </div>
                <div class="data-row">
                  <span class="data-label">速度</span>
                  <span class="data-value">{{ currentFrame.speed.toFixed(1) }} m/s</span>
                </div>
              </div>

              <!-- 飞机姿态 -->
              <div class="data-group">
                <div class="group-title">飞机姿态</div>
                <div class="attitude-grid">
                  <div class="attitude-item">
                    <span class="attitude-label">航向</span>
                    <span class="attitude-value">{{ currentFrame.aircraft.yaw.toFixed(1) }}°</span>
                  </div>
                  <div class="attitude-item">
                    <span class="attitude-label">俯仰</span>
                    <span class="attitude-value">{{ currentFrame.aircraft.pitch.toFixed(1) }}°</span>
                  </div>
                  <div class="attitude-item">
                    <span class="attitude-label">横滚</span>
                    <span class="attitude-value">{{ currentFrame.aircraft.roll.toFixed(1) }}°</span>
                  </div>
                </div>
              </div>

              <!-- 云台状态 -->
              <div class="data-group">
                <div class="group-title">云台状态 ({{ currentFrame.gimbal.mode }})</div>
                <div class="attitude-grid">
                  <div class="attitude-item">
                    <span class="attitude-label">Yaw</span>
                    <span class="attitude-value">{{ currentFrame.gimbal.yaw.toFixed(1) }}°</span>
                  </div>
                  <div class="attitude-item">
                    <span class="attitude-label">Pitch</span>
                    <span class="attitude-value">{{ currentFrame.gimbal.pitch.toFixed(1) }}°</span>
                  </div>
                  <div class="attitude-item">
                    <span class="attitude-label">Roll</span>
                    <span class="attitude-value">{{ currentFrame.gimbal.roll.toFixed(1) }}°</span>
                  </div>
                </div>
              </div>

              <!-- 相机状态 -->
              <div class="data-group">
                <div class="group-title">相机状态</div>
                <div class="camera-status">
                  <span class="status-badge" :class="{ active: currentFrame.camera.isPhoto }">
                    <CameraOutlined />
                    拍照 {{ currentFrame.camera.isPhoto ? '中' : '' }}
                  </span>
                  <span class="status-badge" :class="{ active: currentFrame.camera.isVideo }">
                    <VideoCameraOutlined />
                    录像 {{ currentFrame.camera.isVideo ? '中' : '' }}
                  </span>
                </div>
              </div>

              <!-- 电池与GPS -->
              <div class="data-group">
                <div class="group-title">系统状态</div>
                <div class="data-row">
                  <span class="data-label">电量</span>
                  <span class="data-value">{{ currentFrame.battery.chargeLevel }}%</span>
                </div>
                <div class="data-row">
                  <span class="data-label">电压</span>
                  <span class="data-value">{{ currentFrame.battery.voltage.toFixed(2) }} V</span>
                </div>
                <div class="data-row">
                  <span class="data-label">温度</span>
                  <span class="data-value">{{ currentFrame.battery.temperature.toFixed(1) }}°C</span>
                </div>
                <div class="data-row">
                  <span class="data-label">GPS</span>
                  <span class="data-value">{{ currentFrame.gpsNum }} 颗</span>
                </div>
                <div class="data-row">
                  <span class="data-label">飞控</span>
                  <span class="data-value">{{ currentFrame.flycState }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Button block @click="triggerFileLoad">
        <UploadOutlined />
        加载更多轨迹
      </Button>
    </template>
  </SidePanel>

  <input ref="fileInput" type="file" accept=".json" hidden @change="handleFileChange" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, Slider, Tooltip, Popconfirm, message } from 'ant-design-vue';
import {
  UploadOutlined,
  RocketOutlined,
  AimOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  DeleteOutlined,
  CaretRightOutlined,
  PauseOutlined,
  StopOutlined,
  FastBackwardOutlined,
  CameraOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons-vue';
import { SidePanel } from '.';
import { FlightTrackAnalysis } from '../shared';
import { useFlightTrackStore } from '@/stores/flightTrackStore';

defineOptions({ name: 'FlightTrack' });

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();

const store = useFlightTrackStore();

/* ── 当前帧数据 ── */
const currentFrame = computed(() => {
  const track = store.activeTrack;
  if (!track) return null;
  const idx = store.playback.currentFrameIndex;
  if (idx < 0 || idx >= track.frames.length) return null;
  return track.frames[idx];
});

/* ── 播放控制 ── */
function togglePlayPause() {
  if (store.playback.isPaused) {
    store.resumePlayback();
  } else {
    store.pausePlayback();
  }
}

/* ── 文件加载 ── */
const fileInput = ref<HTMLInputElement | null>(null);

function triggerFileLoad() {
  fileInput.value?.click();
}

async function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    await store.loadFromFile(file);
    message.success('轨迹加载成功');
  } catch (err) {
    message.error('轨迹加载失败：' + (err as Error).message);
  }

  input.value = '';
}

/* ── 加载默认示例 ── */
async function loadDefault() {
  try {
    await store.loadFromUrl('/data/json_result.json');
    message.success('示例轨迹加载成功');
  } catch (err) {
    message.error('示例加载失败：' + (err as Error).message);
  }
}

/* ── 格式化 ── */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
}

function formatDist(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(1)} m`;
}
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hint {
  margin: 0 0 4px;
  color: var(--surface-text-muted);
  font-size: 12px;
  text-align: center;
}

/* ── 轨迹卡片 ── */
.tracks-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.track-card {
  overflow: hidden;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--surface-bg-elevated, var(--surface-bg));
  cursor: pointer;
  transition: all 0.2s;
}

.track-card:hover {
  border-color: var(--color-primary);
}

.track-card.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
}

.track-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--surface-border);
}

.track-info {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.track-icon {
  flex-shrink: 0;
  color: var(--color-primary);
  font-size: 16px;
}

.track-name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-actions {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
}

/* ── 统计信息 ── */
.track-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 10px 12px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  color: var(--surface-text-muted);
  font-size: 11px;
}

.stat-value {
  font-size: 12px;
  font-weight: 500;
}

/* ── 详情区域 ── */
.track-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 12px 12px;
  border-top: 1px solid var(--surface-border);
}

.detail-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding-top: 12px;
  font-size: 12px;
  font-weight: 600;
}

.frame-index {
  color: var(--surface-text-muted);
  font-size: 11px;
  font-weight: 400;
}

/* ── 播放控制 ── */
.playback-section {
  padding-top: 4px;
}

.playback-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.playback-progress :deep(.ant-slider) {
  flex: 1;
  margin: 0;
}

.pb-time {
  flex-shrink: 0;
  color: var(--surface-text-muted);
  font-family: monospace;
  font-size: 11px;
}

.playback-controls {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-bottom: 8px;
}

.playback-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.speed-btns {
  display: flex;
  gap: 4px;
}

/* ── 帧数据 ── */
.frame-data {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.data-group {
  padding: 8px 10px;
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  background: var(--surface-bg);
}

.group-title {
  margin-bottom: 6px;
  color: var(--surface-text-muted);
  font-size: 11px;
  font-weight: 500;
}

.data-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 0;
}

.data-label {
  color: var(--surface-text-muted);
  font-size: 12px;
}

.data-value {
  font-family: monospace;
  font-size: 12px;
}

/* ── 姿态网格 ── */
.attitude-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.attitude-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 0;
}

.attitude-label {
  color: var(--surface-text-muted);
  font-size: 11px;
}

.attitude-value {
  font-family: monospace;
  font-size: 14px;
  font-weight: 600;
}

/* ── 相机状态 ── */
.camera-status {
  display: flex;
  gap: 8px;
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 4px;
  background: var(--surface-border);
  color: var(--surface-text-muted);
  font-size: 12px;
  transition: all 0.2s;
}

.status-badge.active {
  background: var(--color-primary);
  color: #fff;
}
</style>
