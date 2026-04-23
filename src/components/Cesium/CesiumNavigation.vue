<template>
  <div class="cesium-navigation">
    <div class="nav-group">
      <Tooltip title="飞行至初始视野" placement="left">
        <Button class="nav-btn" @click="handleHome">
          <HomeOutlined />
        </Button>
      </Tooltip>
      <Tooltip title="缩小" placement="left">
        <Button class="nav-btn" @click="handleZoomOut">
          <MinusOutlined />
        </Button>
      </Tooltip>
      <Tooltip title="放大" placement="left">
        <Button class="nav-btn" @click="handleZoomIn">
          <PlusOutlined />
        </Button>
      </Tooltip>
    </div>
    <Compass />
  </div>
</template>

<script setup lang="ts">
import { Rectangle } from 'cesium'
import { toRaw } from 'vue'
import { useCesiumStore } from '@/stores/cesiumStore'
import { Button, Tooltip } from 'ant-design-vue'
import { HomeOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons-vue'
import Compass from './Compass.vue'

const cesiumStore = useCesiumStore()

const handleHome = () => {
  const v = toRaw(cesiumStore.viewer)
  if (!v) return
  const chinaRectangle = Rectangle.fromDegrees(73.5, 18.0, 135.0, 53.5)
  v.camera.flyTo({ destination: chinaRectangle })
}

const handleZoomIn = () => {
  const v = toRaw(cesiumStore.viewer)
  if (!v) return
  v.camera.zoomIn(v.camera.positionCartographic.height * 0.1)
}

const handleZoomOut = () => {
  const v = toRaw(cesiumStore.viewer)
  if (!v) return
  v.camera.zoomOut(v.camera.positionCartographic.height * 0.1)
}
</script>

<style scoped>
.cesium-navigation {
  position: absolute;
  top: 42px;
  right: 12px;
  z-index: 10;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-shrink: 0;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: rgba(50, 50, 50, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
  transition: all 0.2s;
}

.nav-btn:hover {
  background: rgba(70, 70, 70, 0.9);
  border-color: rgba(255, 255, 255, 0.4);
}
</style>
