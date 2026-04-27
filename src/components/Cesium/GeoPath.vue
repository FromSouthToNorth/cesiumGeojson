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
        <div v-for="path in store.paths" :key="path.id" class="path-card"
          :class="{ active: path.id === store.activePathId }" @click="store.selectPath(path.id)">
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

              <div class="profile-wrap" @mousemove="onProfileMouseMove" @mouseleave="hoverData = null">
                <svg class="profile-chart" :viewBox="`0 0 ${chartW} ${chartH}`">
                  <!-- 网格线 + 高程标签 -->
                  <line v-for="gl in gridLines" :key="gl.key" :x1="gl.x1" :y1="gl.y1" :x2="gl.x2" :y2="gl.y2"
                    stroke="var(--surface-border)" stroke-width="0.5" stroke-dasharray="3,3" />
                  <text v-for="gl in gridLines" :key="'tl' + gl.key" :x="gl.lx" :y="gl.ly"
                    fill="var(--surface-text-muted)" font-size="8" text-anchor="end">{{ gl.label }}</text>

                  <!-- 填充区域 -->
                  <polygon :points="profileArea(path.elevationProfile)" fill="rgba(24,144,255,0.06)" />

                  <!-- 坡度着色段 -->
                  <line v-for="(seg, i) in coloredSegments" :key="i" :x1="seg.x1" :y1="seg.y1" :x2="seg.x2" :y2="seg.y2"
                    :stroke="seg.color" stroke-width="3" stroke-linecap="round" />

                  <!-- 坐标轴 -->
                  <line :x1="padL" :y1="0" :x2="padL" :y2="chartH - padB" stroke="var(--surface-border)"
                    stroke-width="1" />
                  <line :x1="padL" :y1="chartH - padB" :x2="chartW" :y2="chartH - padB" stroke="var(--surface-border)"
                    stroke-width="1" />

                  <!-- 距离标签 -->
                  <text v-for="dl in distLabels" :key="dl.key" :x="dl.x" :y="dl.y" fill="var(--surface-text-muted)"
                    font-size="8" text-anchor="middle">{{ dl.label }}</text>

                  <!-- 悬停标记 -->
                  <template v-if="hoverData">
                    <line :x1="hoverData.x" :y1="0" :x2="hoverData.x" :y2="chartH - padB" stroke="#ff4d4f"
                      stroke-width="1" stroke-dasharray="2,2" />
                    <circle :cx="hoverData.x" :cy="hoverData.y" r="4" fill="#ff4d4f" stroke="#fff" stroke-width="1.5" />
                  </template>
                </svg>

                <div v-if="hoverData" class="profile-tooltip"
                  :style="{ left: hoverData.tx + 'px', top: hoverData.ty + 'px' }">
                  <span class="tip-dist">{{ hoverData.distance.toFixed(1) }} m</span>
                  <span class="tip-elev">{{ hoverData.elevation.toFixed(0) }} m</span>
                  <span class="tip-slope" :style="{ color: hoverData.slopeColor }">{{
                    Math.abs(hoverData.slope).toFixed(1) }}%</span>
                </div>
              </div>

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

              <!-- 坡度分布条 -->
              <div v-if="slopeDist" class="slope-dist-section">
                <div class="slope-dist-bar">
                  <div class="slope-bar-seg gentle" :style="{ width: slopeDist.gentlePct + '%' }"
                    :title="'平缓 ' + slopeDist.gentlePct.toFixed(0) + '%'"></div>
                  <div class="slope-bar-seg moderate" :style="{ width: slopeDist.moderatePct + '%' }"
                    :title="'中等 ' + slopeDist.moderatePct.toFixed(0) + '%'"></div>
                  <div class="slope-bar-seg steep" :style="{ width: slopeDist.steepPct + '%' }"
                    :title="'陡峭 ' + slopeDist.steepPct.toFixed(0) + '%'"></div>
                </div>
                <div class="slope-dist-labels">
                  <span><span class="dot gentle"></span>平缓 {{ slopeDist.gentlePct.toFixed(0) }}%</span>
                  <span><span class="dot moderate"></span>中等 {{ slopeDist.moderatePct.toFixed(0) }}%</span>
                  <span><span class="dot steep"></span>陡峭 {{ slopeDist.steepPct.toFixed(0) }}%</span>
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
                  <span>已行驶 {{ store.playbackDistance.toFixed(1) }} / {{ path.measurements.total.toFixed(1) }} m</span>
                </div>
                <div class="playback-info-row">
                  <span>{{ formatTime(store.playbackDuration) }} / {{ formatTime(store.playbackEstimatedDuration)
                  }}</span>
                </div>
                <Slider :min="0" :max="1" :step="0.001" :value="store.playbackProgress"
                  @change="(v: any) => store.seekPlayback(v as number)" class="playback-slider" />
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
                  <Button size="small" :type="store.playbackFollowCamera ? 'primary' : 'default'"
                    @click="store.togglePlaybackFollowCamera()">
                    <AimOutlined />
                    {{ store.playbackFollowCamera ? '视角跟随中' : '视角跟随' }}
                  </Button>
                </div>
                <div class="playback-speed">
                  <span class="pb-label">速度</span>
                  <div class="pb-btn-group">
                    <Button :type="store.playbackSpeed === 0.5 ? 'primary' : 'default'" size="small"
                      @click="store.setPlaybackSpeed(0.5)">0.5x</Button>
                    <Button :type="store.playbackSpeed === 1 ? 'primary' : 'default'" size="small"
                      @click="store.setPlaybackSpeed(1)">1x</Button>
                    <Button :type="store.playbackSpeed === 2 ? 'primary' : 'default'" size="small"
                      @click="store.setPlaybackSpeed(2)">2x</Button>
                    <Button :type="store.playbackSpeed === 4 ? 'primary' : 'default'" size="small"
                      @click="store.setPlaybackSpeed(4)">4x</Button>
                  </div>
                </div>
              </template>
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
import { onUnmounted, ref, watch, computed } from 'vue';
import { Button, Input, Slider, Tooltip, Popconfirm, message } from 'ant-design-vue';
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
  CaretRightOutlined,
  PauseOutlined,
  StopOutlined,
  FastBackwardOutlined,
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
  const path = store.activePath;
  if (!path?.elevationProfile) return [];
  const { distances, elevations } = path.elevationProfile;
  if (distances.length < 2) return [];
  const maxD = distances[distances.length - 1] || 1;
  const { minE, hRange } = calcProfileRange(path.elevationProfile);

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
  const path = store.activePath;
  if (!path?.elevationProfile) return [];
  const { minElevation, maxElevation } = path.elevationProfile;
  const range = maxElevation - minElevation;
  let step = Math.pow(10, Math.floor(Math.log10(range)));
  if (range / step < 3) step /= 2;
  if (range / step > 8) step *= 2;
  if (step < 0.1) step = 0.5;

  const start = Math.floor(minElevation / step) * step;
  const end = Math.ceil(maxElevation / step) * step;
  const maxD = path.elevationProfile.distances[path.elevationProfile.distances.length - 1] || 1;
  const { minE, hRange } = calcProfileRange(path.elevationProfile);

  const lines = [];
  for (let e = start; e <= end + step / 2; e += step) {
    const val = Math.round(e / step) * step;
    const y = elevToY(val, minE, hRange);
    if (y < -5 || y > chartH - padB + 5) continue;
    lines.push({
      key: val,
      x1: padL, y1: y, x2: chartW, y2: y,
      lx: padL - 4, ly: y + 3,
      label: `${val.toFixed(val % 1 === 0 ? 0 : 1)}m`,
    });
  }
  return lines;
});

/** X 轴距离标签 */
const distLabels = computed(() => {
  const path = store.activePath;
  if (!path?.elevationProfile) return [];
  const { distances } = path.elevationProfile;
  const maxD = distances[distances.length - 1] || 1;
  const count = Math.min(5, Math.ceil(maxD / 500));
  const step = maxD / Math.max(count, 1);
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
  const path = store.activePath;
  if (!path?.elevationProfile || path.elevationProfile.distances.length < 2) return null;
  const { distances, elevations } = path.elevationProfile;
  let gentle = 0, moderate = 0, steep = 0;
  for (let i = 0; i < distances.length - 1; i++) {
    const segDist = distances[i + 1] - distances[i];
    const slope = segDist > 0 ? Math.abs((elevations[i + 1] - elevations[i]) / segDist * 100) : 0;
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
  x: number; y: number; tx: number; ty: number;
  distance: number; elevation: number; slope: number; slopeColor: string;
} | null>(null);

function onProfileMouseMove(e: MouseEvent) {
  const path = store.activePath;
  if (!path?.elevationProfile) return;
  const { distances, elevations } = path.elevationProfile;
  if (distances.length < 2) return;
  const wrap = e.currentTarget as HTMLElement | null;
  if (!wrap) return;

  const rect = wrap.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const maxD = distances[distances.length - 1] || 1;
  const dataDist = ((mouseX / rect.width) * chartW - padL) / plotW * maxD;

  let nearestIdx = 0;
  let minGap = Infinity;
  for (let i = 0; i < distances.length; i++) {
    const gap = Math.abs(distances[i] - dataDist);
    if (gap < minGap) { minGap = gap; nearestIdx = i; }
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
    slope = ((elevations[nearestIdx] - elevations[nearestIdx - 1]) / (distances[nearestIdx] - distances[nearestIdx - 1])) * 100;
  }

  const { minE, hRange } = calcProfileRange(path.elevationProfile);
  const markerX = distToX(distance, maxD);
  const markerY = elevToY(elevation, minE, hRange);

  // 工具提示定位
  let tx = mouseX + 12;
  let ty = Math.max(4, mouseY - 36);
  if (tx + 130 > rect.width) tx = mouseX - 142;
  if (ty < 4) ty = mouseY + 12;

  hoverData.value = {
    x: markerX, y: markerY, tx, ty,
    distance, elevation, slope,
    slopeColor: getSlopeColor(slope),
  };
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

.profile-wrap {
  position: relative;
}

.profile-chart {
  display: block;
  width: 100%;
  aspect-ratio: 320 / 150;
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  background: var(--surface-bg-secondary, var(--surface-bg));
}

.profile-chart text {
  font-family: inherit;
  -webkit-font-smoothing: antialiased;
}

.profile-tooltip {
  position: absolute;
  display: flex;
  gap: 8px;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--surface-bg);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  font-size: 11px;
  line-height: 1.6;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
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

/* 坡度颜色复用在 tooltip 中 */
.profile-tooltip .tip-slope:is(.gentle, [class*="gentle"]) {
  color: #52C41A;
}

.profile-tooltip .tip-slope:is(.moderate, [class*="moderate"]) {
  color: #FAAD14;
}

.profile-tooltip .tip-slope:is(.steep, [class*="steep"]) {
  color: #FF4D4F;
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
  background: #52C41A;
}

.slope-bar-seg.moderate {
  background: #FAAD14;
}

.slope-bar-seg.steep {
  background: #FF4D4F;
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
  background: #52C41A;
}

.slope-dist-labels .dot.moderate {
  background: #FAAD14;
}

.slope-dist-labels .dot.steep {
  background: #FF4D4F;
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
</style>
