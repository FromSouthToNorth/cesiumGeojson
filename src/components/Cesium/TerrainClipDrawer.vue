<template>
  <Button class="drawer-trigger clip-trigger" type="primary" @click="drawerVisible = true">
    地形裁切
  </Button>
  <Drawer v-model:open="drawerVisible" title="地形裁切" placement="left" :width="320" :mask="false">
    <Space direction="vertical" style="width: 100%">
      <div>
        <span>Inverse（反选）</span>
        <Switch v-model:checked="terrainClipStore.inverse" style="margin-left: 8px" />
      </div>
      <Button
        type="primary"
        block
        :disabled="terrainClipStore.isDrawing"
        @click="terrainClipStore.startDraw"
      >
        {{ terrainClipStore.isDrawing ? '绘制中...' : '开始绘制区域' }}
      </Button>
      <Button
        danger
        block
        :disabled="!terrainClipStore.enabled && !terrainClipStore.isDrawing"
        @click="terrainClipStore.clearClip"
      >
        清除裁剪
      </Button>
      <div v-if="terrainClipStore.isDrawing" style="color: #999">
        左键点击绘制顶点，双击左键撤销，右键点击结束绘制
      </div>
      <div v-if="terrainClipStore.isDrawing" style="color: #666; font-size: 12px">
        已绘制 {{ terrainClipStore.positions.length }} 个顶点
      </div>
    </Space>
  </Drawer>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useTerrainClipStore } from '@/stores/terrainClipStore'
import { Button, Drawer, Space, Switch } from 'ant-design-vue'

const terrainClipStore = useTerrainClipStore()
const drawerVisible = ref(false)
</script>

<style scoped>
.drawer-trigger {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
}
.clip-trigger {
  top: 60px;
}
</style>
