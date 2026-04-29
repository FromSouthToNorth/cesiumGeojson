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
import { onMounted, onUnmounted } from 'vue';
import { Button } from 'ant-design-vue';
import { CloseOutlined } from '@ant-design/icons-vue';

defineOptions({ name: 'SidePanel' });

const props = defineProps<{
  visible: boolean;
  title: string;
  /** 绘制/编辑中禁用 Escape 关闭，防止与绘图快捷键冲突 */
  disableEscape?: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
}>();

/** Escape 键关闭面板（绘制/编辑中不关闭） */
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible && !props.disableEscape) {
    emit('update:visible', false);
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.side-panel {
  position: absolute;
  top: 12px;
  left: 64px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  width: 380px;
  max-height: calc(100vh - 24px);
  overflow: hidden;
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  background: var(--surface-bg);
  box-shadow: 0 4px 24px var(--surface-shadow);
  backdrop-filter: blur(12px);
}

.panel-header {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--surface-header-border, var(--surface-border));
}

.panel-header::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  width: 3px;
  height: 18px;
  border-radius: 0 2px 2px 0;
  background: var(--color-primary);
  transform: translateY(-50%);
}

.panel-title {
  color: var(--color-text);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.panel-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--surface-text-muted);
  transition: all 0.2s ease;
}

.panel-close:hover {
  background: var(--surface-hover);
  color: var(--color-text);
  transform: scale(1.1);
}

.panel-close:active {
  transform: scale(0.95);
}

.panel-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding: 14px 16px;
  scrollbar-width: thin;
  scrollbar-color: var(--surface-border) transparent;
}

.panel-body::-webkit-scrollbar {
  width: 5px;
}

.panel-body::-webkit-scrollbar-track {
  background: transparent;
}

.panel-body::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: var(--surface-border);
}

.panel-body::-webkit-scrollbar-thumb:hover {
  background: var(--surface-text-muted);
}

.panel-enter-active {
  transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

.panel-leave-active {
  transition: all 0.18s ease;
}

.panel-enter-from {
  opacity: 0;
  transform: translateX(-12px) scale(0.98);
}

.panel-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

/* 小屏幕适配 */
@media (width <= 480px) {
  .side-panel {
    left: 64px;
    width: calc(100vw - 76px);
  }
}

/* 减少动画偏好 */
@media (prefers-reduced-motion: reduce) {
  .panel-enter-active,
  .panel-leave-active {
    transition: none;
  }

  .panel-enter-from,
  .panel-leave-to {
    opacity: 0;
    transform: none;
  }
}
</style>
