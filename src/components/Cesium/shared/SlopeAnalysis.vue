<!--
  components/Cesium/SlopeAnalysis.vue —— 空间坡度分析面板
  接收 SlopeAnalysisResult，展示统计网格 + 分布条 + 图例
-->
<template>
  <div class="detail-section">
    <div class="detail-title">空间坡度分析</div>

    <!-- 空态 -->
    <template v-if="!result && !loading">
      <Button size="small" @click="$emit('analyze')"> 开始坡度分析 </Button>
      <p class="hint">在选区内生成网格采样点，分析坡度分布</p>
    </template>

    <!-- 加载态 -->
    <div v-else-if="loading" class="loading-wrap">
      <Spin size="small" />
      <span class="loading-text">正在采样地形并计算坡度...</span>
    </div>

    <!-- 结果态 -->
    <template v-else-if="result && !loading">
      <div class="slope-grid">
        <div class="slope-stat">
          <span class="stat-label">平均坡度</span>
          <span class="stat-value">{{ result.avgSlope.toFixed(1) }}%</span>
          <span class="stat-angle">{{ result.avgAngle.toFixed(1) }}°</span>
        </div>
        <div class="slope-stat">
          <span class="stat-label">最小坡度</span>
          <span class="stat-value">{{ result.minSlope.toFixed(1) }}%</span>
          <span class="stat-angle">{{ result.minAngle.toFixed(1) }}°</span>
        </div>
        <div class="slope-stat">
          <span class="stat-label">最大坡度</span>
          <span class="stat-value">{{ result.maxSlope.toFixed(1) }}%</span>
          <span class="stat-angle">{{ result.maxAngle.toFixed(1) }}°</span>
        </div>
        <div class="slope-stat">
          <span class="stat-label">中位数</span>
          <span class="stat-value">{{ result.medianSlope.toFixed(1) }}%</span>
        </div>
        <div class="slope-stat">
          <span class="stat-label">标准差</span>
          <span class="stat-value">{{ result.stdDevSlope.toFixed(2) }}</span>
        </div>
        <div class="slope-stat">
          <span class="stat-label">采样点</span>
          <span class="stat-value">{{ result.sampleCount }}</span>
        </div>
      </div>

      <!-- 坡度分布条 -->
      <div class="slope-dist-section">
        <div class="slope-dist-bar">
          <div
            class="slope-bar-seg gentle"
            :style="{ width: result.gentlePct + '%' }"
            :title="'平缓 ' + result.gentlePct.toFixed(0) + '%'"
          ></div>
          <div
            class="slope-bar-seg moderate"
            :style="{ width: result.moderatePct + '%' }"
            :title="'中等 ' + result.moderatePct.toFixed(0) + '%'"
          ></div>
          <div
            class="slope-bar-seg steep"
            :style="{ width: result.steepPct + '%' }"
            :title="'陡峭 ' + result.steepPct.toFixed(0) + '%'"
          ></div>
        </div>
        <div class="slope-dist-labels">
          <span><span class="dot gentle"></span>平缓 {{ result.gentlePct.toFixed(0) }}%</span>
          <span><span class="dot moderate"></span>中等 {{ result.moderatePct.toFixed(0) }}%</span>
          <span><span class="dot steep"></span>陡峭 {{ result.steepPct.toFixed(0) }}%</span>
        </div>
      </div>

      <div class="slope-supplement">
        <span>高程起伏 {{ result.elevationRange.toFixed(0) }} m</span>
        <span>网格间距 {{ result.gridSpacing }} m</span>
        <span class="slope-grade-hint">分级: &lt;5°平缓 / 5-15°中等 / ≥15°陡峭</span>
      </div>

      <!-- 图例 + 显隐切换 -->
      <div class="slope-legend">
        <div class="legend-items">
          <span class="legend-item"><span class="legend-dot gentle"></span>平缓</span>
          <span class="legend-item"><span class="legend-dot moderate"></span>中等</span>
          <span class="legend-item"><span class="legend-dot steep"></span>陡峭</span>
        </div>
        <Button size="small" @click="$emit('toggleGrid')">
          {{ showGrid ? '隐藏网格' : '显示网格' }}
        </Button>
      </div>

      <Button size="small" @click="$emit('reanalyze')">
        <ReloadOutlined />
        重新分析
      </Button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Button, Spin } from 'ant-design-vue';
import { ReloadOutlined } from '@ant-design/icons-vue';
import type { SlopeAnalysisResult } from '@/types/geoPolygon';

defineOptions({ name: 'SlopeAnalysis' });

defineProps<{
  result: SlopeAnalysisResult | null;
  loading: boolean;
  showGrid: boolean;
}>();

defineEmits<{
  analyze: [];
  toggleGrid: [];
  reanalyze: [];
}>();
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

.hint {
  margin: 0;
  color: var(--surface-text-muted);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
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

.slope-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.slope-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 2px;
  border: 1px solid var(--surface-border);
  border-radius: 4px;
}

.slope-stat .stat-label {
  color: var(--surface-text-muted);
  font-size: 11px;
}

.slope-stat .stat-value {
  color: var(--color-text);
  font-size: 13px;
  font-weight: 500;
}

.slope-stat .stat-angle {
  margin-left: 4px;
  color: var(--surface-text-muted);
  font-size: 11px;
}

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

.slope-supplement {
  display: flex;
  justify-content: space-between;
  color: var(--surface-text-muted);
  font-size: 11px;
}

.slope-grade-hint {
  display: none;
}

.slope-legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.legend-items {
  display: flex;
  gap: 10px;
  color: var(--surface-text-muted);
  font-size: 11px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 1px solid rgb(255 255 255 / 0.3);
  border-radius: 50%;
}

.legend-dot.gentle {
  background: var(--slope-gentle);
}

.legend-dot.moderate {
  background: var(--slope-moderate);
}

.legend-dot.steep {
  background: var(--slope-steep);
}
</style>
