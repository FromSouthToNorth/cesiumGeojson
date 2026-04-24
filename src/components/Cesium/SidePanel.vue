<!--
  components/Cesium/SidePanel.vue —— 统一侧边面板
  玻璃态模糊背景 + 滑入动画，所有工具面板均基于此组件
  通过插槽 (slot) 嵌入面板内容
-->
<template>
  <Transition name="panel">
    <div v-if="visible" class="side-panel">
      <div class="panel-header">
        <span class="panel-title">{{ title }}</span>
        <Button type="text" size="small" class="panel-close" @click="$emit('update:visible', false)">
          <CloseOutlined />
        </Button>
      </div>
      <div class="panel-body">
        <slot />
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { Button } from 'ant-design-vue'
import { CloseOutlined } from '@ant-design/icons-vue'

defineOptions({ name: 'SidePanel' })

defineProps<{
  visible: boolean
  title: string
}>()

defineEmits<{
  'update:visible': [value: boolean]
}>()
</script>

<style scoped>
.side-panel {
  position: absolute;
  top: 12px;
  left: 56px;
  z-index: 9;
  width: 380px;
  max-height: calc(100vh - 24px);
  background: var(--surface-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--surface-header-border, var(--surface-border));
  flex-shrink: 0;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.panel-close {
  color: var(--surface-text-muted);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel-close:hover {
  color: var(--color-text);
  background: var(--surface-hover);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-enter-active,
.panel-leave-active {
  transition: all 0.2s ease;
}

.panel-enter-from,
.panel-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>
