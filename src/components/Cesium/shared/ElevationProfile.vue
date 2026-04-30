<!--
  components/Cesium/ElevationProfile.vue —— 高程剖面图表组件
  接收 ElevationProfile 数据，渲染 SVG 剖面图 + 统计网格 + 坡度分布
-->
<template>
  <div class="detail-section">
    <div class="detail-title">高程剖面</div>

    <!-- 有数据 -->
    <template v-if="profile">
      <div class="profile-wrap" @mousemove="onProfileMouseMove" @mouseleave="hoverData = null">
        <svg class="profile-chart" :viewBox="`${-vbPad} ${-vbPad} ${chartW + vbPad * 2} ${chartH + vbPad * 2}`">
          <!-- 网格线 + 高程标签 -->
          <line
            v-for="gl in gridLines"
            :key="gl.key"
            :x1="gl.x1"
            :y1="gl.y1"
            :x2="gl.x2"
            :y2="gl.y2"
            stroke="var(--surface-border)"
            stroke-width="0.5"
            stroke-dasharray="3,3"
          />
          <text
            v-for="gl in gridLines"
            :key="'tl' + gl.key"
            :x="gl.lx"
            :y="gl.ly"
            fill="var(--surface-text-muted)"
            font-size="8"
            text-anchor="end"
          >
            {{ gl.label }}
          </text>

          <!-- 填充区域 -->
          <polygon :points="profileArea(profile)" fill="rgba(24,144,255,0.06)" />

          <!-- 坡度着色段 -->
          <line
            v-for="(seg, i) in coloredSegments"
            :key="i"
            :x1="seg.x1"
            :y1="seg.y1"
            :x2="seg.x2"
            :y2="seg.y2"
            :stroke="seg.color"
            stroke-width="3"
            stroke-linecap="round"
          />

          <!-- 坐标轴 -->
          <line :x1="padL" :y1="0" :x2="padL" :y2="chartH - padB" stroke="var(--surface-border)" stroke-width="1" />
          <line
            :x1="padL"
            :y1="chartH - padB"
            :x2="chartW"
            :y2="chartH - padB"
            stroke="var(--surface-border)"
            stroke-width="1"
          />

          <!-- 距离标签 -->
          <text
            v-for="dl in distLabels"
            :key="dl.key"
            :x="dl.x"
            :y="dl.y"
            fill="var(--surface-text-muted)"
            font-size="8"
            text-anchor="middle"
          >
            {{ dl.label }}
          </text>

          <!-- 悬停标记 -->
          <template v-if="hoverData">
            <line
              :x1="hoverData.x"
              :y1="0"
              :x2="hoverData.x"
              :y2="chartH - padB"
              stroke="#ff4d4f"
              stroke-width="1"
              stroke-dasharray="2,2"
            />
            <circle :cx="hoverData.x" :cy="hoverData.y" r="4" fill="#ff4d4f" stroke="#fff" stroke-width="1.5" />
          </template>
        </svg>

        <div v-if="hoverData" class="profile-tooltip" :style="{ left: hoverData.tx + 'px', top: hoverData.ty + 'px' }">
          <span class="tip-dist">{{ hoverData.distance.toFixed(1) }} m</span>
          <span class="tip-elev">{{ hoverData.elevation.toFixed(0) }} m</span>
          <span class="tip-slope" :style="{ color: hoverData.slopeColor }"
            >{{ Math.abs(hoverData.slope).toFixed(1) }}%</span
          >
        </div>
      </div>

      <div class="profile-stats">
        <div class="stat">
          <span class="stat-label">最低</span>
          <span class="stat-value">{{ profile.minElevation.toFixed(0) }} m</span>
        </div>
        <div class="stat">
          <span class="stat-label">最高</span>
          <span class="stat-value">{{ profile.maxElevation.toFixed(0) }} m</span>
        </div>
        <div class="stat">
          <span class="stat-label">平均</span>
          <span class="stat-value">{{ profile.avgElevation.toFixed(0) }} m</span>
        </div>
        <div class="stat">
          <span class="stat-label">爬升</span>
          <span class="stat-value">{{ profile.totalClimb.toFixed(0) }} m</span>
        </div>
        <div class="stat">
          <span class="stat-label">下降</span>
          <span class="stat-value">{{ profile.totalDescent.toFixed(0) }} m</span>
        </div>
        <div class="stat">
          <span class="stat-label">坡度</span>
          <span class="stat-value">{{ profile.avgGradient.toFixed(1) }}%</span>
        </div>
      </div>

      <!-- 坡度分布条 -->
      <div v-if="slopeDist" class="slope-dist-section">
        <div class="slope-dist-bar">
          <div
            class="slope-bar-seg gentle"
            :style="{ width: slopeDist.gentlePct + '%' }"
            :title="'平缓 ' + slopeDist.gentlePct.toFixed(0) + '%'"
          ></div>
          <div
            class="slope-bar-seg moderate"
            :style="{ width: slopeDist.moderatePct + '%' }"
            :title="'中等 ' + slopeDist.moderatePct.toFixed(0) + '%'"
          ></div>
          <div
            class="slope-bar-seg steep"
            :style="{ width: slopeDist.steepPct + '%' }"
            :title="'陡峭 ' + slopeDist.steepPct.toFixed(0) + '%'"
          ></div>
        </div>
        <div class="slope-dist-labels">
          <span><span class="dot gentle"></span>平缓 {{ slopeDist.gentlePct.toFixed(0) }}%</span>
          <span><span class="dot moderate"></span>中等 {{ slopeDist.moderatePct.toFixed(0) }}%</span>
          <span><span class="dot steep"></span>陡峭 {{ slopeDist.steepPct.toFixed(0) }}%</span>
        </div>
      </div>
    </template>

    <!-- 加载中 -->
    <div v-else-if="loading" class="loading-wrap">
      <Spin size="small" />
      <span class="loading-text">正在采样地形高程...</span>
    </div>

    <!-- 空态：提供重新采样 -->
    <Button v-else size="small" @click="$emit('resample')">
      <ReloadOutlined />
      重新采样
    </Button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, Spin } from 'ant-design-vue';
import { ReloadOutlined } from '@ant-design/icons-vue';
import type { ElevationProfile } from '@/types/geoPath';

defineOptions({ name: 'ElevationProfile' });

const props = defineProps<{
  profile: ElevationProfile | null;
  loading: boolean;
}>();

defineEmits<{
  resample: [];
}>();

/* ── SVG 剖面图 ── */
const chartW = 320;
const chartH = 150;
const padL = 34;
const padB = 22;
const plotW = chartW - padL;
const plotH = chartH - padB;
const vbPad = 16; // viewBox 额外边距防止边缘文字被裁切

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

/* ── 剖面图增强：坡度着色、网格线、交互 ── */

const SLOPE_COLORS = { gentle: '#52C41A', moderate: '#FAAD14', steep: '#FF4D4F' };

function getSlopeColor(slope: number): string {
  const abs = Math.abs(slope);
  if (abs < 5) return SLOPE_COLORS.gentle;
  if (abs < 15) return SLOPE_COLORS.moderate;
  return SLOPE_COLORS.steep;
}

/** 计算 viewBox Y 坐标 */
function elevToY(elev: number, minE: number, hRange: number): number {
  return chartH - padB - ((elev - minE) / hRange) * plotH;
}

/** 计算 viewBox X 坐标 */
function distToX(dist: number, maxD: number): number {
  return padL + (dist / maxD) * plotW;
}

function calcProfileRange(profile: ElevationProfile) {
  const minE = profile.minElevation;
  const maxE = profile.maxElevation;
  const range = Math.max(maxE - minE, 1);
  const padding = range * 0.1;
  return { minE: minE - padding, maxE: maxE + padding, hRange: maxE - minE + 2 * padding };
}

/** 坡度着色段 */
const coloredSegments = computed(() => {
  const profile = props.profile;
  if (!profile) return [];
  const { distances, elevations } = profile;
  if (distances.length < 2) return [];
  const maxD = distances[distances.length - 1] || 1;
  const { minE, hRange } = calcProfileRange(profile);

  return distances.slice(0, -1).map((_, i) => {
    const segDist = distances[i + 1] - distances[i];
    const slope = segDist > 0 ? ((elevations[i + 1] - elevations[i]) / segDist) * 100 : 0;
    return {
      x1: distToX(distances[i], maxD),
      y1: elevToY(elevations[i], minE, hRange),
      x2: distToX(distances[i + 1], maxD),
      y2: elevToY(elevations[i + 1], minE, hRange),
      color: getSlopeColor(slope),
    };
  });
});

/** 网格线 & 高程标签 */
const gridLines = computed(() => {
  const profile = props.profile;
  if (!profile) return [];
  const { minElevation, maxElevation } = profile;
  const range = maxElevation - minElevation;
  let step = Math.pow(10, Math.floor(Math.log10(range)));
  if (range / step < 3) step /= 2;
  if (range / step > 8) step *= 2;
  if (step < 0.1) step = 0.5;

  const start = Math.floor(minElevation / step) * step;
  const end = Math.ceil(maxElevation / step) * step;
  const { minE, hRange } = calcProfileRange(profile);

  const lines = [];
  for (let e = start; e <= end + step / 2; e += step) {
    const val = Math.round(e / step) * step;
    const y = elevToY(val, minE, hRange);
    if (y < -5 || y > chartH - padB + 5) continue;
    lines.push({
      key: val,
      x1: padL,
      y1: y,
      x2: chartW,
      y2: y,
      lx: padL - 4,
      ly: y + 3,
      label: `${val.toFixed(val % 1 === 0 ? 0 : 1)}m`,
    });
  }
  return lines;
});

/** X 轴距离标签 */
const distLabels = computed(() => {
  const profile = props.profile;
  if (!profile) return [];
  const { distances } = profile;
  const maxD = distances[distances.length - 1] || 1;
  const count = Math.min(5, Math.ceil(maxD / 500));
  const labels = [];
  for (let i = 0; i <= count; i++) {
    const d = (maxD / count) * i;
    const x = distToX(d, maxD);
    labels.push({
      key: i,
      x,
      y: chartH - padB + 13,
      label: i === 0 ? '0' : `${(d / 1000).toFixed(d >= 1000 ? 1 : 0)}${d >= 1000 ? 'k' : ''}m`,
    });
  }
  return labels;
});

/** 坡度分布（按距离占比） */
const slopeDist = computed(() => {
  const profile = props.profile;
  if (!profile || profile.distances.length < 2) return null;
  const { distances, elevations } = profile;
  let gentle = 0,
    moderate = 0,
    steep = 0;
  for (let i = 0; i < distances.length - 1; i++) {
    const segDist = distances[i + 1] - distances[i];
    const slope = segDist > 0 ? Math.abs(((elevations[i + 1] - elevations[i]) / segDist) * 100) : 0;
    if (slope < 5) gentle += segDist;
    else if (slope < 15) moderate += segDist;
    else steep += segDist;
  }
  const total = gentle + moderate + steep;
  if (total < 1) return null;
  return {
    gentlePct: (gentle / total) * 100,
    moderatePct: (moderate / total) * 100,
    steepPct: (steep / total) * 100,
  };
});

/* ── 鼠标悬停交互 ── */
const hoverData = ref<{
  x: number;
  y: number;
  tx: number;
  ty: number;
  distance: number;
  elevation: number;
  slope: number;
  slopeColor: string;
} | null>(null);

function onProfileMouseMove(e: MouseEvent) {
  const profile = props.profile;
  if (!profile) return;
  const { distances, elevations } = profile;
  if (distances.length < 2) return;
  const wrap = e.currentTarget as HTMLElement | null;
  if (!wrap) return;

  const rect = wrap.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;

  const maxD = distances[distances.length - 1] || 1;
  const dataDist = (((mouseX / rect.width) * chartW - padL) / plotW) * maxD;

  let nearestIdx = 0;
  // distances 为单调递增数组，使用二分查找代替线性扫描 O(log n)
  let lo = 0,
    hi = distances.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (distances[mid] < dataDist) lo = mid + 1;
    else hi = mid;
  }
  nearestIdx = lo;
  if (lo > 0) {
    const dPrev = Math.abs(distances[lo - 1] - dataDist);
    const dCurr = Math.abs(distances[lo] - dataDist);
    if (dPrev < dCurr) nearestIdx = lo - 1;
  }

  const distance = distances[nearestIdx];
  const elevation = elevations[nearestIdx];

  // 中心差分计算坡度
  let slope = 0;
  if (nearestIdx > 0 && nearestIdx < elevations.length - 1) {
    const segDist = distances[nearestIdx + 1] - distances[nearestIdx - 1];
    if (segDist > 0) slope = ((elevations[nearestIdx + 1] - elevations[nearestIdx - 1]) / segDist) * 100;
  } else if (nearestIdx === 0 && distances.length > 1) {
    slope = ((elevations[1] - elevations[0]) / (distances[1] - distances[0])) * 100;
  } else if (nearestIdx === elevations.length - 1 && elevations.length > 1) {
    slope =
      ((elevations[nearestIdx] - elevations[nearestIdx - 1]) / (distances[nearestIdx] - distances[nearestIdx - 1])) *
      100;
  }

  const { minE, hRange } = calcProfileRange(profile);
  const markerX = distToX(distance, maxD);
  const markerY = elevToY(elevation, minE, hRange);

  // 工具提示定位（fixed，相对于视口避免被滚动容器裁切）
  let tx = e.clientX + 12;
  let ty = e.clientY - 36;
  if (tx + 130 > window.innerWidth) tx = e.clientX - 142;
  if (ty < 4) ty = e.clientY + 12;

  hoverData.value = {
    x: markerX,
    y: markerY,
    tx,
    ty,
    distance,
    elevation,
    slope,
    slopeColor: getSlopeColor(slope),
  };
}
</script>

<style scoped>
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

.profile-wrap {
  position: relative;
}

.profile-chart {
  display: block;
  width: 100%;
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  background: var(--surface-bg-secondary, var(--surface-bg));
  aspect-ratio: 352 / 182;
}

.profile-chart text {
  font-family: inherit;
  -webkit-font-smoothing: antialiased;
}

.profile-tooltip {
  position: fixed;
  z-index: 400;
  display: flex;
  gap: 8px;
  padding: 3px 8px;
  border: 1px solid var(--surface-border);
  border-radius: 4px;
  background: var(--surface-bg);
  box-shadow: 0 4px 12px var(--surface-shadow);
  font-size: 11px;
  line-height: 1.6;
  white-space: nowrap;
  pointer-events: none;
}

.profile-tooltip .tip-dist {
  color: var(--surface-text-muted);
}

.profile-tooltip .tip-elev {
  color: var(--color-text);
  font-weight: 500;
}

.profile-tooltip .tip-slope {
  font-weight: 500;
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

/* ── 坡度分布条 ── */

.slope-dist-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.slope-dist-bar {
  display: flex;
  height: 8px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--surface-bg-secondary, var(--surface-bg));
}

.slope-bar-seg {
  transition: width 0.3s;
}

.slope-bar-seg.gentle {
  background: var(--slope-gentle);
}

.slope-bar-seg.moderate {
  background: var(--slope-moderate);
}

.slope-bar-seg.steep {
  background: var(--slope-steep);
}

.slope-dist-labels {
  display: flex;
  justify-content: space-between;
  color: var(--surface-text-muted);
  font-size: 11px;
}

.slope-dist-labels .dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-radius: 50%;
  vertical-align: middle;
}

.slope-dist-labels .dot.gentle {
  background: var(--slope-gentle);
}

.slope-dist-labels .dot.moderate {
  background: var(--slope-moderate);
}

.slope-dist-labels .dot.steep {
  background: var(--slope-steep);
}

.loading-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
}

.loading-text {
  color: var(--surface-text-muted);
  font-size: 12px;
}
</style>
