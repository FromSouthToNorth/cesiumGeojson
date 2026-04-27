<!--
  components/Cesium/VertexTable.vue —— 顶点坐标表格
  通用组件，支持可选的地形高程列
-->
<template>
  <div class="detail-section">
    <div class="detail-title">
      顶点坐标 ({{ vertices.length }})
      <Button size="small" type="link" class="copy-btn" @click="handleCopy">复制</Button>
      <Button size="small" type="link" class="copy-btn" @click="handleCsv">CSV</Button>
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
          <tr v-for="(v, i) in vertices" :key="i">
            <td>{{ i + 1 }}</td>
            <td>{{ v.lng.toFixed(5) }}</td>
            <td>{{ v.lat.toFixed(5) }}</td>
            <td>{{ formatElevation(v) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button, message } from 'ant-design-vue';

export interface VertexRow {
  lng: number;
  lat: number;
  height: number;
  elevation?: number | null;
}

defineOptions({ name: 'VertexTable' });

const props = defineProps<{
  vertices: VertexRow[];
}>();

const emit = defineEmits<{
  copy: [text: string];
  csv: [text: string];
}>();

function formatElevation(v: VertexRow): string {
  if (v.elevation !== null && v.elevation !== undefined) {
    return `${v.elevation.toFixed(1)} m`;
  }
  return `${v.height.toFixed(1)} m`;
}

function formatAll() {
  const header = '#\t经度\t纬度\t海拔';
  const rows = props.vertices.map(
    (v, i) => `${i + 1}\t${v.lng.toFixed(5)}\t${v.lat.toFixed(5)}\t${formatElevation(v)}`,
  );
  return [header, ...rows].join('\n');
}

function formatCsv() {
  const header = '#,经度,纬度,海拔';
  const rows = props.vertices.map(
    (v, i) =>
      `${i + 1},${v.lng.toFixed(5)},${v.lat.toFixed(5)},${v.elevation !== null && v.elevation !== undefined ? v.elevation.toFixed(1) : v.height.toFixed(1)}`,
  );
  return '﻿' + [header, ...rows].join('\n');
}

function handleCopy() {
  const text = formatAll();
  navigator.clipboard.writeText(text).then(
    () => message.success('顶点坐标已复制'),
    () => message.error('复制失败'),
  );
  emit('copy', text);
}

function handleCsv() {
  const text = formatCsv();
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `顶点坐标_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  emit('csv', text);
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

.copy-btn {
  float: right;
  padding: 0 4px;
  font-size: 11px;
}

.vertex-table-wrap {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--surface-border);
  border-radius: 4px;
}

.vertex-table {
  width: 100%;
  font-size: 11px;
  border-collapse: collapse;
}

.vertex-table th,
.vertex-table td {
  padding: 3px 6px;
  border-bottom: 1px solid var(--surface-border);
  text-align: right;
}

.vertex-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface-bg-secondary, var(--surface-bg));
  color: var(--surface-text-muted);
  font-weight: 600;
  text-align: right;
}

.vertex-table td:first-child,
.vertex-table th:first-child {
  text-align: center;
}

.vertex-table tr:last-child td {
  border-bottom: none;
}
</style>
