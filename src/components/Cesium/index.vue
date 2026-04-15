<template>
  <div ref="cesiumContainer" class="cesium-container">
    <GeoJsonDrawer />
    <TerrainClipDrawer />
    <CesiumNavigation />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Viewer } from 'cesium'
import { createViewer } from '@/utils/cesium'
import { useCesiumStore } from '@/stores/cesiumStore'
import GeoJsonDrawer from './GeoJsonDrawer.vue'
import TerrainClipDrawer from './TerrainClipDrawer.vue'
import CesiumNavigation from './CesiumNavigation.vue'

const { setViewer } = useCesiumStore()
const cesiumContainer = ref<HTMLDivElement | null>(null)
const viewer = ref<Viewer | null>(null)

onMounted(() => {
  if (cesiumContainer.value) {
    viewer.value = createViewer(cesiumContainer.value)
    setViewer(viewer.value)
  }
})
</script>

<style scoped>
.cesium-container {
  width: 100%;
  height: 100vh;
  position: relative;
  overflow: hidden;
  overscroll-behavior: none;
}
</style>
