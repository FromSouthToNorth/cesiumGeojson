<!--
  components/Cesium/shared/FlightTrackAnalysis.vue
  飞行轨迹分析：高度-时间剖面、速度-时间剖面
-->
<template>
  <div class="track-analysis">
    <div class="analysis-title">轨迹分析</div>

    <!-- 高度剖面 -->
    <div class="chart-wrap" @mousemove="onHeightMouseMove" @mouseleave="hoverIndex = null">
      <div class="chart-label">高度-时间</div>
      <svg class="chart-svg" :viewBox="`${-padL} ${-padT} ${chartW + padL + padR} ${chartH + padT + padB}`">
        <!-- 网格线 -->
        <line v-for="gl in heightGridLines" :key="gl.key" :x1="padL" :y1="gl.y" :x2="chartW" :y2="gl.y"
          stroke="var(--surface-border)" stroke-width="0.5" stroke-dasharray="3,3" />
        <text v-for="gl in heightGridLines" :key="'t' + gl.key" :x="padL - 4" :y="gl.y + 3"
          fill="var(--surface-text-muted)" font-size="8" text-anchor="end">
          {{ gl.label }}
        </text>

        <!-- 填充区域 -->
        <polygon :points="heightAreaPoints" fill="rgba(24,144,255,0.06)" />

        <!-- 高度曲线 -->
        <polyline :points="heightLinePoints" fill="none" stroke="#1890FF" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" />

        <!-- 悬停标记 -->
        <template v-if="hoverIndex !== null">
          <line :x1="hoverX" :y1="0" :x2="hoverX" :y2="chartH" stroke="#ff4d4f" stroke-width="1"
            stroke-dasharray="2,2" />
          <circle :cx="hoverX" :cy="hoverHeightY" r="4" fill="#ff4d4f" stroke="#fff" stroke-width="1.5" />
        </template>

        <!-- 坐标轴 -->
        <line :x1="padL" :y1="0" :x2="padL" :y2="chartH" stroke="var(--surface-border)" stroke-width="1" />
        <line :x1="padL" :y1="chartH" :x2="chartW" :y2="chartH" stroke="var(--surface-border)" stroke-width="1" />
      </svg>

      <div v-if="hoverIndex !== null" class="chart-tooltip">
        <span class="tip-time">{{ formatTime(hoverFrame.timestamp) }}</span>
        <span class="tip-value" style="color: #1890ff">{{ hoverFrame.altitude.toFixed(1) }} m</span>
      </div>
    </div>

    <!-- 速度剖面 -->
    <div class="chart-wrap" @mousemove="onSpeedMouseMove" @mouseleave="hoverSpeedIndex = null">
      <div class="chart-label">速度-时间</div>
      <svg class="chart-svg" :viewBox="`${-padL} ${-padT} ${chartW + padL + padR} ${chartH + padT + padB}`">
        <!-- 网格线 -->
        <line v-for="gl in speedGridLines" :key="gl.key" :x1="padL" :y1="gl.y" :x2="chartW" :y2="gl.y"
          stroke="var(--surface-border)" stroke-width="0.5" stroke-dasharray="3,3" />
        <text v-for="gl in speedGridLines" :key="'t' + gl.key" :x="padL - 4" :y="gl.y + 3"
          fill="var(--surface-text-muted)" font-size="8" text-anchor="end">
          {{ gl.label }}
        </text>

        <!-- 填充区域 -->
        <polygon :points="speedAreaPoints" fill="rgba(82,196,26,0.06)" />

        <!-- 速度曲线 -->
        <polyline :points="speedLinePoints" fill="none" stroke="#52C41A" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" />

        <!-- 悬停标记 -->
        <template v-if="hoverSpeedIndex !== null">
          <line :x1="hoverSpeedX" :y1="0" :x2="hoverSpeedX" :y2="chartH" stroke="#ff4d4f" stroke-width="1"
            stroke-dasharray="2,2" />
          <circle :cx="hoverSpeedX" :cy="hoverSpeedY" r="4" fill="#ff4d4f" stroke="#fff" stroke-width="1.5" />
        </template>

        <!-- 坐标轴 -->
        <line :x1="padL" :y1="0" :x2="padL" :y2="chartH" stroke="var(--surface-border)" stroke-width="1" />
        <line :x1="padL" :y1="chartH" :x2="chartW" :y2="chartH" stroke="var(--surface-border)" stroke-width="1" />
      </svg>

      <div v-if="hoverSpeedIndex !== null" class="chart-tooltip">
        <span class="tip-time">{{ formatTime(hoverSpeedFrame.timestamp) }}</span>
        <span class="tip-value" style="color: #52c41a">{{ hoverSpeedFrame.speed.toFixed(1) }} m/s</span>
      </div>
    </div>

    <!-- 统计摘要 -->
    <div class="analysis-stats">
      <div class="stat">
        <span class="stat-label">平均高度</span>
        <span class="stat-value">{{ avgHeight.toFixed(1) }} m</span>
      </div>
      <div class="stat">
        <span class="stat-label">平均速度</span>
        <span class="stat-value">{{ avgSpeed.toFixed(1) }} m/s</span>
      </div>
      <div class="stat">
        <span class="stat-label">爬升高度</span>
        <span class="stat-value">{{ climbHeight.toFixed(1) }} m</span>
      </div>
      <div class="stat">
        <span class="stat-label">最大速度</span>
        <span class="stat-value">{{ maxSpeed.toFixed(1) }} m/s</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FlightTrackFrame } from '@/types/flightTrack';

defineOptions({ name: 'FlightTrackAnalysis' });

const props = defineProps<{
  frames: FlightTrackFrame[];
  totalTime: number;
}>();

/* ── 图表尺寸 ── */
const chartW = 300;
const chartH = 100;
const padL = 38;
const padR = 8;
const padT = 8;
const padB = 16;

/* ── 高度数据 ── */
const heightRange = computed(() => {
  const heights = props.frames.map((f) => f.altitude);
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const range = Math.max(max - min, 1);
  const padding = range * 0.1;
  return { min: min - padding, max: max + padding, range: range + 2 * padding };
});

function timeToX(time: number): number {
  return padL + (time / Math.max(props.totalTime, 1)) * (chartW - padL);
}

function heightToY(alt: number): number {
  const r = heightRange.value;
  return chartH - ((alt - r.min) / r.range) * chartH;
}

const heightLinePoints = computed(() => {
  return props.frames.map((f) => `${timeToX(f.timestamp)},${heightToY(f.altitude)}`).join(' ');
});

const heightAreaPoints = computed(() => {
  const first = props.frames[0];
  const last = props.frames[props.frames.length - 1];
  if (!first || !last) return '';
  const startX = timeToX(first.timestamp);
  const endX = timeToX(last.timestamp);
  return `${startX},${chartH} ${heightLinePoints.value} ${endX},${chartH}`;
});

const heightGridLines = computed(() => {
  const { min, max, range } = heightRange.value;
  let step = Math.pow(10, Math.floor(Math.log10(range)));
  if (range / step < 3) step /= 2;
  if (range / step > 8) step *= 2;
  if (step < 0.1) step = 0.5;

  const lines = [];
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  for (let v = start; v <= end + step / 2; v += step) {
    const val = Math.round(v / step) * step;
    const y = heightToY(val);
    if (y < -5 || y > chartH + 5) continue;
    lines.push({ key: val, y, label: `${val.toFixed(val % 1 === 0 ? 0 : 1)}m` });
  }
  return lines;
});

/* ── 速度数据 ── */
const speedRange = computed(() => {
  const speeds = props.frames.map((f) => f.speed);
  const max = Math.max(...speeds, 1);
  return { max: max * 1.1 };
});

function speedToY(spd: number): number {
  return chartH - (spd / speedRange.value.max) * chartH;
}

const speedLinePoints = computed(() => {
  return props.frames.map((f) => `${timeToX(f.timestamp)},${speedToY(f.speed)}`).join(' ');
});

const speedAreaPoints = computed(() => {
  const first = props.frames[0];
  const last = props.frames[props.frames.length - 1];
  if (!first || !last) return '';
  const startX = timeToX(first.timestamp);
  const endX = timeToX(last.timestamp);
  return `${startX},${chartH} ${speedLinePoints.value} ${endX},${chartH}`;
});

const speedGridLines = computed(() => {
  const max = speedRange.value.max;
  let step = Math.pow(10, Math.floor(Math.log10(max)));
  if (max / step < 3) step /= 2;
  if (max / step > 8) step *= 2;
  if (step < 0.1) step = 0.5;

  const lines = [];
  for (let v = 0; v <= max + step / 2; v += step) {
    const val = Math.round(v / step) * step;
    const y = speedToY(val);
    if (y < -5 || y > chartH + 5) continue;
    lines.push({ key: val, y, label: `${val.toFixed(val % 1 === 0 ? 0 : 1)}` });
  }
  return lines;
});

/* ── 统计 ── */
const avgHeight = computed(() => props.frames.reduce((s, f) => s + f.altitude, 0) / props.frames.length);
const avgSpeed = computed(() => props.frames.reduce((s, f) => s + f.speed, 0) / props.frames.length);
const climbHeight = computed(() => {
  let climb = 0;
  for (let i = 1; i < props.frames.length; i++) {
    const diff = props.frames[i].altitude - props.frames[i - 1].altitude;
    if (diff > 0) climb += diff;
  }
  return climb;
});
const maxSpeed = computed(() => Math.max(...props.frames.map((f) => f.speed)));

/* ── 悬停交互 ── */
const hoverIndex = ref<number | null>(null);
const hoverX = computed(() => (hoverIndex.value !== null ? timeToX(props.frames[hoverIndex.value].timestamp) : 0));
const hoverHeightY = computed(() =>
  hoverIndex.value !== null ? heightToY(props.frames[hoverIndex.value].altitude) : 0,
);
const hoverFrame = computed(() => props.frames[hoverIndex.value ?? 0]);

function onHeightMouseMove(e: MouseEvent) {
  const wrap = e.currentTarget as HTMLElement | null;
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, x / rect.width));
  const targetTime = ratio * props.totalTime;

  let nearest = 0;
  let minDiff = Infinity;
  for (let i = 0; i < props.frames.length; i++) {
    const diff = Math.abs(props.frames[i].timestamp - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = i;
    }
  }
  hoverIndex.value = nearest;
}

const hoverSpeedIndex = ref<number | null>(null);
const hoverSpeedX = computed(() =>
  hoverSpeedIndex.value !== null ? timeToX(props.frames[hoverSpeedIndex.value].timestamp) : 0,
);
const hoverSpeedY = computed(() =>
  hoverSpeedIndex.value !== null ? speedToY(props.frames[hoverSpeedIndex.value].speed) : 0,
);
const hoverSpeedFrame = computed(() => props.frames[hoverSpeedIndex.value ?? 0]);

function onSpeedMouseMove(e: MouseEvent) {
  const wrap = e.currentTarget as HTMLElement | null;
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, x / rect.width));
  const targetTime = ratio * props.totalTime;

  let nearest = 0;
  let minDiff = Infinity;
  for (let i = 0; i < props.frames.length; i++) {
    const diff = Math.abs(props.frames[i].timestamp - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = i;
    }
  }
  hoverSpeedIndex.value = nearest;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
</script>

<style scoped>
.track-analysis {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.analysis-title {
  color: var(--surface-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.chart-wrap {
  position: relative;
}

.chart-label {
  margin-bottom: 4px;
  color: var(--surface-text-muted);
  font-size: 11px;
}

.chart-svg {
  display: block;
  width: 100%;
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  background: var(--surface-bg-secondary, var(--surface-bg));
  aspect-ratio: 346 / 124;
}

.chart-svg text {
  font-family: inherit;
  -webkit-font-smoothing: antialiased;
}

.chart-tooltip {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 8px;
  padding: 2px 8px;
  border: 1px solid var(--surface-border);
  border-radius: 4px;
  background: var(--surface-bg);
  font-size: 11px;
  pointer-events: none;
}

.tip-time {
  color: var(--surface-text-muted);
}

.tip-value {
  font-weight: 500;
}

/* ── 统计 ── */
.analysis-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.analysis-stats .stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 4px;
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  background: var(--surface-bg);
}

.analysis-stats .stat-label {
  color: var(--surface-text-muted);
  font-size: 11px;
}

.analysis-stats .stat-value {
  font-family: monospace;
  font-size: 12px;
  font-weight: 500;
}
</style>
