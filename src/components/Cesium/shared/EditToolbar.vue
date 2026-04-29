<!--
  components/Cesium/EditToolbar.vue —— 通用编辑器工具栏
  完成编辑 / 撤销 / 重做 / 操作提示 / 相机锁定提示
-->
<template>
  <template v-if="visible">
    <Button type="primary" block @click="$emit('finish')">
      <CheckOutlined />
      完成编辑
    </Button>
    <div class="edit-toolbar">
      <Button size="small" :disabled="!canUndo" @click="$emit('undo')">撤销</Button>
      <Button size="small" :disabled="!canRedo" @click="$emit('redo')">重做</Button>
    </div>
    <div class="editing-tip">
      拖动顶点调整形状 · 点击线段添加顶点 · 右键顶点删除<br />
      <kbd>Delete</kbd> 选中删除 · <kbd>Ctrl+Z</kbd> 撤销 · <kbd>Esc</kbd> 退出<br />
    </div>
    <div class="vertex-count">共 {{ vertexCount }} 个顶点</div>
  </template>
</template>

<script setup lang="ts">
import { Button } from 'ant-design-vue';
import { CheckOutlined } from '@ant-design/icons-vue';

defineOptions({ name: 'EditToolbar' });

defineProps<{
  visible: boolean;
  canUndo: boolean;
  canRedo: boolean;
  vertexCount: number;
}>();

defineEmits<{
  finish: [];
  undo: [];
  redo: [];
}>();
</script>

<style scoped>
.edit-toolbar {
  display: flex;
  gap: 8px;
}

.editing-tip {
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.editing-tip kbd {
  display: inline-block;
  margin: 0 1px;
  padding: 1px 5px;
  border: 1px solid var(--panel-border);
  border-radius: 3px;
  background: var(--panel-surface);
  font-family: inherit;
  font-size: 11px;
}

.vertex-count {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.camera-lock-hint {
  display: inline-block;
  margin-top: 4px;
  color: var(--warning-color, #faad14);
  font-size: 11px;
}
</style>
