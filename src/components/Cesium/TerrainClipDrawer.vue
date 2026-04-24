<template>
  <SidePanel :visible="visible" title="地形裁切" @update:visible="emit('update:visible', $event)">
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
      <div v-if="terrainClipStore.isDrawing" class="drawing-tip">
        左键点击绘制顶点，双击左键撤销，右键点击结束绘制
      </div>
      <div v-if="terrainClipStore.isDrawing" class="drawing-count">
        已绘制 {{ terrainClipStore.positions.length }} 个顶点
      </div>
    </Space>
  </SidePanel>
</template>

<script setup lang="ts">
import { useTerrainClipStore } from '@/stores/terrainClipStore'
import { Button, Space, Switch } from 'ant-design-vue'
import SidePanel from './SidePanel.vue'

defineOptions({ name: 'TerrainClipDrawer' })

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

const terrainClipStore = useTerrainClipStore()
</script>

<style scoped>
.drawing-tip {
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.drawing-count {
  color: var(--color-text-secondary);
  font-size: 12px;
}
</style>
