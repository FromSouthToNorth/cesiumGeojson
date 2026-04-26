<!--
  components/Cesium/index.vue —— Cesium 地图容器
  创建并持有 Viewer 实例，挂载工具箱和导航控件
-->
<template>
  <div ref="cesiumContainer" class="cesium-container">
    <Toolbox />
    <CesiumNavigation />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { Viewer } from 'cesium';
import { createViewer } from '@/utils/cesium';
import { useCesiumStore } from '@/stores/cesiumStore';
import Toolbox from './Toolbox.vue';
import CesiumNavigation from './CesiumNavigation.vue';

const { setViewer, clearViewer } = useCesiumStore();
const cesiumContainer = ref<HTMLDivElement | null>(null);
const viewer = ref<Viewer | null>(null);

onMounted(() => {
  if (cesiumContainer.value) {
    viewer.value = createViewer(cesiumContainer.value);
    setViewer(viewer.value);
  }
});

onUnmounted(() => {
  if (viewer.value && !viewer.value.isDestroyed()) {
    viewer.value.destroy();
  }
  clearViewer();
  viewer.value = null;
});
</script>

<style scoped>
.cesium-container {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  overscroll-behavior: none;
}
</style>
