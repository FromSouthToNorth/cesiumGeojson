<!--
  components/Cesium/SidePanel.vue —— 统一侧边面板
  玻璃态模糊背景 + 滑入动画，所有工具面板均基于此组件
  通过插槽 (slot) 嵌入面板内容
-->
<template>
  <Transition name="panel">
    <div
      v-if="visible"
      class="side-panel"
    >
      <div class="panel-header">
        <span class="panel-title">{{ title }}</span>
        <Button
          type="text"
          size="small"
          class="panel-close"
          @click="$emit('update:visible', false)"
        >
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
import { Button } from 'ant-design-vue';
import { CloseOutlined } from '@ant-design/icons-vue';

defineOptions({ name: 'SidePanel' });

defineProps<{
  visible: boolean;
  title: string;
}>();

defineEmits<{
  'update:visible': [value: boolean];
}>();
</script>

<style scoped>
.side-panel {
  position: absolute;
  top: 12px;
  left: 56px;
  z-index: 9;
  display: flex;
  flex-direction: column;
  width: 380px;
  max-height: calc(100vh - 24px);
  overflow: hidden;
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  background: var(--surface-bg);
  backdrop-filter: blur(12px);
}

.panel-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--surface-header-border, var(--surface-border));
}

.panel-title {
  color: var(--color-text);
  font-size: 14px;
  font-weight: 600;
}

.panel-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--surface-text-muted);
}

.panel-close:hover {
  background: var(--surface-hover);
  color: var(--color-text);
}

.panel-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding: 14px;
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
