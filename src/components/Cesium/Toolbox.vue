<!--
  components/Cesium/Toolbox.vue —— 左侧悬浮工具栏
  三个入口（GeoJSON / 地形裁切 / 观测点），点击切换对应的 SidePanel
-->
<template>
  <div class="toolbox">
    <div class="toolbox-bar">
      <div class="toolbox-header">
        <AppstoreOutlined class="header-icon" />
      </div>

      <div class="toolbox-group">
        <Tooltip title="GeoJSON 管理" placement="right">
          <Button
            class="tool-btn"
            :type="activeTool === 'geojson' ? 'primary' : 'default'"
            @click="toggleTool('geojson')"
          >
            <FileTextOutlined />
          </Button>
        </Tooltip>
      </div>

      <div class="toolbox-group">
        <Tooltip title="地形裁切" placement="right">
          <Button
            class="tool-btn"
            :type="activeTool === 'clip' ? 'primary' : 'default'"
            @click="toggleTool('clip')"
          >
            <ScissorOutlined />
          </Button>
        </Tooltip>
      </div>

      <div class="toolbox-group">
        <Tooltip title="添加观测点" placement="right">
          <Button
            class="tool-btn"
            :type="activeTool === 'point' ? 'primary' : 'default'"
            @click="toggleTool('point')"
          >
            <EnvironmentOutlined />
          </Button>
        </Tooltip>
      </div>
    </div>

    <GeoJsonDrawer :visible="activeTool === 'geojson'" @update:visible="onPanelClose" />
    <TerrainClipDrawer :visible="activeTool === 'clip'" @update:visible="onPanelClose" />
    <PointCreator :visible="activeTool === 'point'" @update:visible="onPanelClose" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Button, Tooltip } from 'ant-design-vue'
import {
  AppstoreOutlined,
  FileTextOutlined,
  ScissorOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons-vue'
import GeoJsonDrawer from './GeoJsonDrawer.vue'
import TerrainClipDrawer from './TerrainClipDrawer.vue'
import PointCreator from './PointCreator.vue'

defineOptions({ name: 'Toolbox' })

/** 当前打开的工具面板名称，null 表示全部关闭 */
const activeTool = ref<string | null>(null)

function toggleTool(tool: string) {
  activeTool.value = activeTool.value === tool ? null : tool
}

function onPanelClose(visible: boolean) {
  if (!visible) activeTool.value = null
}
</script>

<style scoped>
.toolbox {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  display: flex;
}

.toolbox-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: var(--surface-bg);
  backdrop-filter: blur(8px);
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  padding: 8px 6px;
  width: 48px;
  flex-shrink: 0;
}

.toolbox-header {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--surface-header-border, var(--surface-border));
  margin-bottom: 2px;
}

.header-icon {
  font-size: 18px;
  color: var(--surface-text-muted);
}

.toolbox-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 0;
}

.tool-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 6px;
  background: var(--nav-btn-bg);
  border: 1px solid var(--nav-btn-border);
  color: var(--nav-btn-text);
  transition: all 0.2s;
  font-size: 16px;
}

.tool-btn:hover {
  background: var(--nav-btn-hover-bg);
  border-color: var(--nav-btn-hover-border);
  color: var(--nav-btn-hover-text);
}

.tool-btn:active {
  background: var(--nav-btn-active-bg);
}
</style>
