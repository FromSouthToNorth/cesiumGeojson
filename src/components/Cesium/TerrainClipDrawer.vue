<!--
  components/Cesium/TerrainClipDrawer.vue —— 地形裁切面板
  提供绘制、编辑、管理裁切区域的 UI，与 terrainClipStore 绑定的协调器模式
-->
<template>
  <SidePanel :visible="visible" title="地形裁切" @update:visible="emit('update:visible', $event)">
    <Space direction="vertical" style="width: 100%">
      <!-- Inverse 反选开关 -->
      <div>
        <span>Inverse（反选）</span>
        <Switch v-model:checked="store.inverse" style="margin-left: 8px" />
      </div>

      <!-- ── 空闲状态：无区域 ── -->
      <Button
        v-if="!store.hasRegions && !store.isDrawing && !store.isEditing"
        type="primary"
        block
        @click="store.startDraw()"
      >
        开始绘制区域
      </Button>

      <!-- ── 绘制中 ── -->
      <template v-if="store.isDrawing">
        <Button danger block @click="store.cancelDraw()">取消绘制</Button>
        <div class="drawing-tip">
          左键点击绘制顶点，双击左键撤销，右键点击结束绘制
        </div>
        <div class="vertex-count">
          已绘制 {{ store.positions.length }} 个顶点
        </div>
      </template>

      <!-- ── 已有区域（非编辑状态） ── -->
      <template v-if="store.hasRegions && !store.isDrawing && !store.isEditing">
        <div class="region-list">
          <div
            v-for="region in store.regions"
            :key="region.id"
            class="region-row"
            :class="{ active: region.id === store.activeRegionId }"
            @click="store.selectRegion(region.id)"
          >
            <span class="region-dot" />
            <span class="region-name">{{ region.name }}</span>
            <span class="region-count">{{ region.positions.length }} 顶点</span>
            <Button size="small" type="link" class="region-act-btn" @click.stop="store.startEdit(region.id)">编辑</Button>
            <Popconfirm title="确认删除该区域？" placement="left" @confirm.stop="store.clearRegion(region.id)">
              <Button size="small" type="link" danger class="region-act-btn" @click.stop>删除</Button>
            </Popconfirm>
          </div>
        </div>

        <Button block @click="store.startDraw()">+ 新增区域</Button>
        <Popconfirm title="确认清除所有裁切区域？" placement="bottom" @confirm="store.clearAll()">
          <Button danger block>清除全部</Button>
        </Popconfirm>
      </template>

      <!-- ── 编辑中 ── -->
      <template v-if="store.isEditing">
        <Button type="primary" block @click="store.stopEdit()">完成编辑</Button>
        <div class="edit-toolbar">
          <Button size="small" :disabled="!store.canUndo" @click="store.undo()">撤销</Button>
          <Button size="small" :disabled="!store.canRedo" @click="store.redo()">重做</Button>
        </div>
        <div class="editing-tip">
          拖动顶点调整形状 · 点击线段添加顶点 · 右键顶点删除<br />
          <kbd>Delete</kbd> 选中删除 · <kbd>Ctrl+Z</kbd> 撤销 · <kbd>Esc</kbd> 退出<br />
          <span class="camera-lock-hint">编辑期间相机已锁定</span>
        </div>
        <div class="vertex-count">共 {{ store.positions.length }} 个顶点</div>
      </template>
    </Space>
  </SidePanel>
</template>

<script setup lang="ts">
import { useTerrainClipStore } from '@/stores/terrainClipStore'
import { Button, Space, Switch, Popconfirm } from 'ant-design-vue'
import SidePanel from './SidePanel.vue'

defineOptions({ name: 'TerrainClipDrawer' })

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

const store = useTerrainClipStore()
</script>

<style scoped>
.drawing-tip, .editing-tip {
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.editing-tip kbd {
  display: inline-block;
  padding: 1px 5px;
  font-size: 11px;
  font-family: inherit;
  background: var(--panel-surface);
  border: 1px solid var(--panel-border);
  border-radius: 3px;
  margin: 0 1px;
}

.vertex-count {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.camera-lock-hint {
  display: inline-block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--warning-color, #faad14);
}

.edit-toolbar {
  display: flex;
  gap: 8px;
}

.region-list {
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  overflow: hidden;
}

.region-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  transition: background 0.15s;
  border-bottom: 1px solid var(--panel-border);
}

.region-row:last-child {
  border-bottom: none;
}

.region-row:hover {
  background: var(--panel-hover);
}

.region-row.active {
  background: var(--primary-1, color-mix(in srgb, var(--primary-color) 10%, transparent));
}

.region-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 2px solid var(--primary-color);
  flex-shrink: 0;
  transition: background 0.15s;
}

.region-row.active .region-dot {
  background: var(--primary-color);
}

.region-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
}

.region-count {
  font-size: 11px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

.region-act-btn {
  font-size: 12px;
  padding: 0 4px;
  height: auto;
  flex-shrink: 0;
}
</style>
