<!--
  components/Cesium/shared/ListToolbar.vue —— 通用列表工具栏
  计数 + 批量显隐 + 删除全部 + 搜索框
  供 GeoJson / GeoPath / GeoPolygon 面板复用
-->
<template>
  <div class="list-toolbar">
    <slot name="left">
      <span class="list-count">共 {{ count }} 个{{ itemName }}</span>
    </slot>
    <div class="toolbar-actions">
      <slot name="actions" />
      <Tooltip :title="allVisible ? '全部隐藏' : '全部显示'">
        <Button
          size="small"
          :type="allVisible ? 'default' : 'primary'"
          class="icon-only-btn"
          :aria-label="allVisible ? '全部隐藏' : '全部显示'"
          @click="emit('toggleAllVisibility')"
        >
          <EyeOutlined v-if="allVisible" />
          <EyeInvisibleOutlined v-else />
        </Button>
      </Tooltip>
      <Popconfirm :title="`确认删除所有${itemName}？`" placement="topRight" @confirm="emit('removeAll')">
        <Button danger size="small" type="dashed" class="icon-only-btn" :aria-label="`删除全部${itemName}`">
          <CloseCircleOutlined />
        </Button>
      </Popconfirm>
      <InputSearch
        :value="searchQuery"
        :placeholder="searchPlaceholder"
        allow-clear
        size="small"
        class="layer-search"
        @update:value="(v: string) => emit('update:searchQuery', v)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button, Input, Tooltip, Popconfirm } from 'ant-design-vue';
import { EyeOutlined, EyeInvisibleOutlined, CloseCircleOutlined } from '@ant-design/icons-vue';

defineOptions({ name: 'ListToolbar' });

defineProps<{
  count: number;
  allVisible: boolean;
  searchQuery?: string;
  searchPlaceholder?: string;
  itemName?: string;
}>();

const emit = defineEmits<{
  toggleAllVisibility: [];
  removeAll: [];
  'update:searchQuery': [value: string];
}>();

const InputSearch = Input.Search;
</script>

<style scoped>
.list-toolbar {
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}

.list-count {
  color: var(--color-text-secondary);
  font-size: 13px;
  white-space: nowrap;
}

.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 1;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.icon-only-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
}

.layer-search {
  width: 140px;
}
</style>
