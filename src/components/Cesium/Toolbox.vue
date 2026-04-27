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
          <Button class="tool-btn" :type="activeTool === 'clip' ? 'primary' : 'default'" @click="toggleTool('clip')">
            <ScissorOutlined />
          </Button>
        </Tooltip>
      </div>

      <div class="toolbox-group">
        <Tooltip title="添加观测点" placement="right">
          <Button class="tool-btn" :type="activeTool === 'point' ? 'primary' : 'default'" @click="toggleTool('point')">
            <EnvironmentOutlined />
          </Button>
        </Tooltip>
      </div>

      <div class="toolbox-group">
        <Tooltip title="地质路径" placement="right">
          <Button class="tool-btn" :type="activeTool === 'geoPath' ? 'primary' : 'default'" @click="toggleTool('geoPath')">
            <NodeIndexOutlined />
          </Button>
        </Tooltip>
      </div>

      <div class="toolbox-group">
        <Tooltip title="多边形勘测" placement="right">
          <Button class="tool-btn" :type="activeTool === 'geoPolygon' ? 'primary' : 'default'" @click="toggleTool('geoPolygon')">
            <AuditOutlined />
          </Button>
        </Tooltip>
      </div>
    </div>

    <GeoJson :visible="activeTool === 'geojson'" @update:visible="onPanelClose" />
    <TerrainClip :visible="activeTool === 'clip'" @update:visible="onPanelClose" />
    <PointCreator :visible="activeTool === 'point'" @update:visible="onPanelClose" />
    <GeoPath :visible="activeTool === 'geoPath'" @update:visible="onPanelClose" />
    <GeoPolygon :visible="activeTool === 'geoPolygon'" @update:visible="onPanelClose" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Button, Tooltip } from 'ant-design-vue';
import { AppstoreOutlined, FileTextOutlined, ScissorOutlined, EnvironmentOutlined, NodeIndexOutlined, AuditOutlined } from '@ant-design/icons-vue';
import { GeoJson, TerrainClip, PointCreator, GeoPath, GeoPolygon } from './panels';

defineOptions({ name: 'Toolbox' });

/** 当前打开的工具面板名称，null 表示全部关闭 */
const activeTool = ref<string | null>(null);

function toggleTool(tool: string) {
  activeTool.value = activeTool.value === tool ? null : tool;
}

function onPanelClose(visible: boolean) {
  if (!visible) activeTool.value = null;
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
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  width: 48px;
  padding: 8px 6px;
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  background: var(--surface-bg);
  backdrop-filter: blur(8px);
}

.toolbox-header {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin-bottom: 2px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--surface-header-border, var(--surface-border));
}

.header-icon {
  color: var(--surface-text-muted);
  font-size: 18px;
}

.toolbox-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 0;
}

.tool-btn {
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
  font-size: 16px;
  transition: all 0.2s;
}

.tool-btn:hover {
  border-color: var(--nav-btn-hover-border);
  background: var(--nav-btn-hover-bg);
  color: var(--nav-btn-hover-text);
}

.tool-btn:active {
  background: var(--nav-btn-active-bg);
}
</style>
