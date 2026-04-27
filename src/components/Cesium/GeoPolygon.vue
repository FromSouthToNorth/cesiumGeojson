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
            <div class="detail-section">
              <div class="detail-title">
                顶点坐标 ({{ store.vertexData.length }})
                <Button size="small" type="link" class="copy-btn" @click.stop="copyVertices">复制</Button>
                <Button size="small" type="link" class="copy-btn" @click.stop="store.exportVerticesCsv()">CSV</Button>
              </div>
              <div class="vertex-table-wrap">
                <table class="vertex-table" @click.stop>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>经度</th>
                      <th>纬度</th>
                      <th>海拔</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(v, i) in store.vertexData" :key="i">
                      <td>{{ i + 1 }}</td>
                      <td>{{ v.lng.toFixed(5) }}</td>
                      <td>{{ v.lat.toFixed(5) }}</td>
                      <td>{{ v.elevation !== null ? `${v.elevation.toFixed(1)} m` : '-' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- ── 坡度分析 ── -->
            <div class="detail-section">
              <div class="detail-title">空间坡度分析</div>

              <template v-if="!store.slopeResult && !store.slopeLoading">
                <Button size="small" @click.stop="store.analyzeSlope(poly.id)">
                  开始坡度分析
                </Button>
                <p class="hint">在选区内生成网格采样点，分析坡度分布</p>
              </template>

              <template v-if="store.slopeLoading">
                <div class="loading-hint">正在采样地形并计算坡度...</div>
              </template>

              <template v-if="store.slopeResult && !store.slopeLoading">
                <div class="slope-grid">
                  <div class="slope-stat">
                    <span class="stat-label">平均坡度</span>
                    <span class="stat-value">{{ store.slopeResult.avgSlope.toFixed(1) }}%</span>
                    <span class="stat-angle">{{ store.slopeResult.avgAngle.toFixed(1) }}°</span>
                  </div>
                  <div class="slope-stat">
                    <span class="stat-label">最小坡度</span>
                    <span class="stat-value">{{ store.slopeResult.minSlope.toFixed(1) }}%</span>
                    <span class="stat-angle">{{ store.slopeResult.minAngle.toFixed(1) }}°</span>
                  </div>
                  <div class="slope-stat">
                    <span class="stat-label">最大坡度</span>
                    <span class="stat-value">{{ store.slopeResult.maxSlope.toFixed(1) }}%</span>
                    <span class="stat-angle">{{ store.slopeResult.maxAngle.toFixed(1) }}°</span>
                  </div>
                  <div class="slope-stat">
                    <span class="stat-label">中位数</span>
                    <span class="stat-value">{{ store.slopeResult.medianSlope.toFixed(1) }}%</span>
                  </div>
                  <div class="slope-stat">
                    <span class="stat-label">标准差</span>
                    <span class="stat-value">{{ store.slopeResult.stdDevSlope.toFixed(2) }}</span>
                  </div>
                  <div class="slope-stat">
                    <span class="stat-label">采样点</span>
                    <span class="stat-value">{{ store.slopeResult.sampleCount }}</span>
                  </div>
                </div>

                <!-- 坡度分布条 -->
                <div class="slope-dist-section">
                  <div class="slope-dist-bar">
                    <div class="slope-bar-seg gentle" :style="{ width: store.slopeResult.gentlePct + '%' }"
                      :title="'平缓 ' + store.slopeResult.gentlePct.toFixed(0) + '%'"></div>
                    <div class="slope-bar-seg moderate" :style="{ width: store.slopeResult.moderatePct + '%' }"
                      :title="'中等 ' + store.slopeResult.moderatePct.toFixed(0) + '%'"></div>
                    <div class="slope-bar-seg steep" :style="{ width: store.slopeResult.steepPct + '%' }"
                      :title="'陡峭 ' + store.slopeResult.steepPct.toFixed(0) + '%'"></div>
                  </div>
                  <div class="slope-dist-labels">
                    <span><span class="dot gentle"></span>平缓 {{ store.slopeResult.gentlePct.toFixed(0) }}%</span>
                    <span><span class="dot moderate"></span>中等 {{ store.slopeResult.moderatePct.toFixed(0) }}%</span>
                    <span><span class="dot steep"></span>陡峭 {{ store.slopeResult.steepPct.toFixed(0) }}%</span>
                  </div>
                </div>

                <div class="slope-supplement">
                  <span>高程起伏 {{ store.slopeResult.elevationRange.toFixed(0) }} m</span>
                  <span>网格间距 {{ store.slopeResult.gridSpacing }} m</span>
                  <span style="font-size: 11px; color: var(--surface-text-muted);">分级: &lt;5°平缓 / 5-15°中等 /
                    ≥15°陡峭</span>
                </div>

                <!-- 图例 + 显隐切换 -->
                <div class="slope-legend">
                  <div class="legend-items">
                    <span class="legend-item"><span class="legend-dot gentle"></span>平缓</span>
                    <span class="legend-item"><span class="legend-dot moderate"></span>中等</span>
                    <span class="legend-item"><span class="legend-dot steep"></span>陡峭</span>
                  </div>
                  <Button size="small" @click.stop="store.toggleSlopeGrid()">
                    <template v-if="store.showSlopeGrid">隐藏网格</template>
                    <template v-else>显示网格</template>
                  </Button>
                </div>

                <Button size="small" @click.stop="store.analyzeSlope(poly.id)">
                  <ReloadOutlined />
                  重新分析
                </Button>
              </template>
            </div>

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
  CheckOutlined,
  ReloadOutlined,
  TagsOutlined,
  TagsFilled,
} from '@ant-design/icons-vue';
import SidePanel from './SidePanel.vue';
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

/* ── 顶点坐标复制 ── */
function copyVertices() {
  const data = store.vertexData;
  if (!data.length) return;
  const text = ['#\t经度\t纬度\t海拔',
    ...data.map((v, i) =>
      `${i + 1}\t${v.lng.toFixed(5)}\t${v.lat.toFixed(5)}\t${v.elevation !== null ? v.elevation.toFixed(1) : '-'}`),
  ].join('\n');
  navigator.clipboard.writeText(text).then(
    () => message.success('顶点坐标已复制'),
    () => message.error('复制失败'),
  );
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

/* ── 坡度分析 ── */

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
  color: var(--surface-text-muted);
  font-size: 11px;
  margin-left: 4px;
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

.slope-supplement {
  display: flex;
  justify-content: space-between;
  color: var(--surface-text-muted);
  font-size: 11px;
}

.loading-hint {
  padding: 8px;
  color: var(--surface-text-muted);
  font-size: 12px;
  text-align: center;
}

/* ── 坡度图例 ── */

.slope-legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.legend-items {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: var(--surface-text-muted);
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
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.legend-dot.gentle {
  background: #52C41A;
}

.legend-dot.moderate {
  background: #FAAD14;
}

.legend-dot.steep {
  background: #FF4D4F;
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

/* ── 顶点表格 ── */
.vertex-table-wrap {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--surface-border);
  border-radius: 4px;
}

.vertex-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.vertex-table th,
.vertex-table td {
  padding: 3px 6px;
  text-align: right;
  border-bottom: 1px solid var(--surface-border);
}

.vertex-table th {
  position: sticky;
  top: 0;
  background: var(--surface-bg-secondary, var(--surface-bg));
  font-weight: 600;
  color: var(--surface-text-muted);
  text-align: right;
  z-index: 1;
}

.vertex-table td:first-child,
.vertex-table th:first-child {
  text-align: center;
}

.vertex-table tr:last-child td {
  border-bottom: none;
}

.copy-btn {
  float: right;
  padding: 0 4px;
  font-size: 11px;
}

/* ── 详情工具按钮 ── */
.detail-tools {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
</style>
