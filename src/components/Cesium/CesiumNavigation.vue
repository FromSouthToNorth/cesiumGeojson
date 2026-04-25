<!--
  components/Cesium/CesiumNavigation.vue —— 导航控件
  右上角悬浮：主题切换、飞行至中国视野、缩放、可拖拽罗盘
-->
<template>
  <div class="cesium-navigation">
    <div class="nav-group">
      <Tooltip
        title="切换主题"
        placement="left"
      >
        <Button
          class="nav-btn"
          @click="themeStore.toggle"
        >
          <BulbOutlined v-if="themeStore.isDark" />
          <BulbFilled v-else />
        </Button>
      </Tooltip>
      <Tooltip
        title="飞行至初始视野"
        placement="left"
      >
        <Button
          class="nav-btn"
          @click="handleHome"
        >
          <HomeOutlined />
        </Button>
      </Tooltip>
      <Tooltip
        title="缩小"
        placement="left"
      >
        <Button
          class="nav-btn"
          @click="handleZoomOut"
        >
          <MinusOutlined />
        </Button>
      </Tooltip>
      <Tooltip
        title="放大"
        placement="left"
      >
        <Button
          class="nav-btn"
          @click="handleZoomIn"
        >
          <PlusOutlined />
        </Button>
      </Tooltip>
    </div>
    <Compass />
  </div>
</template>

<script setup lang="ts">
import { Rectangle } from 'cesium';
import { toRaw } from 'vue';
import { useCesiumStore } from '@/stores/cesiumStore';
import { useThemeStore } from '@/stores/themeStore';
import { Button, Tooltip } from 'ant-design-vue';
import { HomeOutlined, MinusOutlined, PlusOutlined, BulbOutlined, BulbFilled } from '@ant-design/icons-vue';
import Compass from './Compass.vue';

const cesiumStore = useCesiumStore();
const themeStore = useThemeStore();

/** 飞行至中国范围 (73.5°E–135°E, 18°N–53.5°N) */
const handleHome = () => {
  const v = toRaw(cesiumStore.viewer);
  if (!v) return;
  const chinaRectangle = Rectangle.fromDegrees(73.5, 18.0, 135.0, 53.5);
  v.camera.flyTo({ destination: chinaRectangle });
};

/** 缩小（按当前高度的 10%） */
const handleZoomIn = () => {
  const v = toRaw(cesiumStore.viewer);
  if (!v) return;
  v.camera.zoomIn(v.camera.positionCartographic.height * 0.1);
};

/** 放大（按当前高度的 10%） */
const handleZoomOut = () => {
  const v = toRaw(cesiumStore.viewer);
  if (!v) return;
  v.camera.zoomOut(v.camera.positionCartographic.height * 0.1);
};
</script>

<style scoped>
.cesium-navigation {
  position: absolute;
  top: 42px;
  right: 12px;
  z-index: 10;
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  gap: 12px;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  background: var(--surface-bg);
  backdrop-filter: blur(8px);
}

.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--nav-btn-border);
  border-radius: 6px;
  background: var(--nav-btn-bg);
  color: var(--nav-btn-text);
  cursor: pointer;
  transition: all 0.2s;
}

.nav-btn:hover {
  border-color: var(--nav-btn-hover-border);
  background: var(--nav-btn-hover-bg);
  color: var(--nav-btn-hover-text);
}

.nav-btn:active {
  background: var(--nav-btn-active-bg);
}
</style>
