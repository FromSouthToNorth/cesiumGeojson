<!--
  components/Cesium/GeoJsonDrawer.vue —— GeoJSON 管理面板
  上传 .geojson/.json 文件，自动解析并着色渲染，
  支持图层列表搜索、显隐、删除、要素属性查看
-->
<template>
  <SidePanel :visible="visible" title="GeoJSON 管理" @update:visible="emit('update:visible', $event)">
    <Upload :before-upload="handleUpload" accept=".geojson,.json" :show-upload-list="false">
      <Button type="dashed" block :loading="isUploading">
        <UploadOutlined />
        {{ isUploading ? '正在解析…' : '上传 GeoJSON' }}
      </Button>
    </Upload>

    <div v-if="geoJsonStore.layers.length" class="layers-section">
      <div class="layers-toolbar">
        <span class="layers-count">共 {{ geoJsonStore.layers.length }} 个图层</span>
        <InputSearch
          v-model:value="searchQuery"
          placeholder="搜索图层名称"
          allow-clear
          size="small"
          class="layer-search"
        />
      </div>

      <div ref="scrollRef" class="layers-scroll">
        <Collapse v-model:activeKey="activeKeys" ghost destroy-inactive-panel>
          <CollapsePanel
            v-for="layer in filteredLayers"
            :key="layer.id"
            class="layer-panel"
          >
            <template #header>
              <div class="panel-header">
                <div class="layer-info" :class="{ 'is-hidden': !layer.show }">
                  <span class="color-badge" :style="{ backgroundColor: layer.color }">
                    {{ layer.features.length }}
                  </span>
                  <span class="layer-name" :title="layer.name">{{ layer.name }}</span>
                </div>
                <div class="layer-actions">
                  <Tooltip title="定位图层">
                    <Button type="text" size="small" class="action-btn" @click.stop="geoJsonStore.flyToLayer(layer.id)">
                      <EnvironmentOutlined />
                    </Button>
                  </Tooltip>
                  <Tooltip :title="layer.show ? '隐藏图层' : '显示图层'">
                    <Button type="text" size="small" class="action-btn" @click.stop="geoJsonStore.toggleLayerVisibility(layer.id)">
                      <EyeOutlined v-if="layer.show" />
                      <EyeInvisibleOutlined v-else />
                    </Button>
                  </Tooltip>
                  <Popconfirm title="确认删除该图层？" placement="topRight" @confirm.stop="geoJsonStore.removeLayer(layer.id)">
                    <Tooltip title="删除图层">
                      <Button type="text" danger size="small" class="action-btn" @click.stop>
                        <DeleteOutlined />
                      </Button>
                    </Tooltip>
                  </Popconfirm>
                </div>
              </div>
            </template>

            <List :data-source="layer.features" size="small" :pagination="{ pageSize: 5, size: 'small', hideOnSinglePage: true }">
              <template #renderItem="{ item }">
                <div class="feature-wrapper">
                  <ListItem class="feature-item" @click="geoJsonStore.flyToFeature(item.entity)">
                    <div class="feature-left">
                      <span class="feature-dot" :style="{ backgroundColor: layer.color }"></span>
                      <span class="feature-name" :title="item.name">{{ item.name }}</span>
                    </div>
                    <div class="feature-actions">
                      <Tooltip title="查看属性">
                        <Button type="text" size="small" class="action-btn" @click.stop="toggleFeatureProperties(item.id)">
                          <InfoCircleOutlined />
                        </Button>
                      </Tooltip>
                      <Tooltip title="定位要素">
                        <Button type="text" size="small" class="action-btn" @click.stop="geoJsonStore.flyToFeature(item.entity)">
                          <AimOutlined />
                        </Button>
                      </Tooltip>
                    </div>
                  </ListItem>

                  <div v-if="expandedFeatureIds.has(item.id) && Object.keys(item.properties || {}).length" class="feature-properties">
                    <Descriptions bordered :column="1" size="small">
                      <DescriptionsItem v-for="(val, key) in item.properties" :key="key" :label="String(key)">
                        <span class="property-value" :title="String(val)">{{ val }}</span>
                      </DescriptionsItem>
                    </Descriptions>
                  </div>
                  <div v-else-if="expandedFeatureIds.has(item.id)" class="feature-properties-empty">
                    <Empty description="暂无属性" :image="Empty.PRESENTED_IMAGE_SIMPLE" />
                  </div>
                </div>
              </template>
            </List>
          </CollapsePanel>
        </Collapse>

        <Empty v-if="!filteredLayers.length" description="未找到匹配的图层" class="filter-empty" />
      </div>
    </div>

    <Empty v-else description="暂无 GeoJSON 数据" />
  </SidePanel>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, useTemplateRef } from 'vue'
import { useGeoJsonStore } from '@/stores/geojsonStore'
import {
  Button, Upload, List, Collapse, CollapsePanel,
  Tooltip, Popconfirm, Empty, Input, Descriptions,
} from 'ant-design-vue'
import {
  UploadOutlined, EnvironmentOutlined, DeleteOutlined,
  AimOutlined, InfoCircleOutlined, EyeOutlined, EyeInvisibleOutlined,
} from '@ant-design/icons-vue'
import SidePanel from './SidePanel.vue'

defineOptions({ name: 'GeoJsonDrawer' })

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

const InputSearch = Input.Search
const ListItem = List.Item
const DescriptionsItem = Descriptions.Item

const geoJsonStore = useGeoJsonStore()
const activeKeys = ref<string[]>([])        // 展开的 CollapsePanel key
const searchQuery = ref('')                  // 搜索关键词
const isUploading = ref(false)
const scrollRef = useTemplateRef<HTMLDivElement>('scrollRef')
const expandedFeatureIds = ref<Set<string>>(new Set())  // 已展开属性的要素

/** 切换要素属性的展开/收起 */
function toggleFeatureProperties(featureId: string) {
  const next = new Set(expandedFeatureIds.value)
  if (next.has(featureId)) next.delete(featureId)
  else next.add(featureId)
  expandedFeatureIds.value = next
}

/** 根据搜索词过滤图层列表 */
const filteredLayers = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return geoJsonStore.layers
  return geoJsonStore.layers.filter(layer => layer.name.toLowerCase().includes(query))
})

/** 新图层添加时自动展开并滚动到顶部 */
watch(
  () => geoJsonStore.layers.length,
  async (newLength, oldLength) => {
    if (newLength > (oldLength ?? 0)) {
      const newestLayer = geoJsonStore.layers[geoJsonStore.layers.length - 1]
      if (newestLayer && !activeKeys.value.includes(newestLayer.id)) {
        activeKeys.value = [...activeKeys.value, newestLayer.id]
      }
      await nextTick()
      scrollRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }
)

const handleUpload = async (file: File) => {
  isUploading.value = true
  try {
    await geoJsonStore.loadGeoJson(file)
  } finally {
    isUploading.value = false
  }
  return false   // 阻止默认上传行为
}
</script>

<style scoped>
.layers-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

.layers-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}

.layers-count {
  font-size: 13px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.layer-search {
  width: 180px;
}

.layers-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  padding: 8px;
}

.layer-panel {
  border-radius: 6px;
  overflow: hidden;
  background: var(--panel-surface);
  margin-bottom: 8px;
}

.layer-panel:last-child {
  margin-bottom: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 8px;
}

.layer-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  transition: opacity 0.2s;
}

.layer-info.is-hidden {
  opacity: 0.5;
}

.color-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border-radius: 12px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.layer-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  font-size: 14px;
  color: var(--color-text);
}

.layer-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 4px;
}

.feature-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  border-radius: 4px;
  transition: background-color 0.2s;
  cursor: pointer;
}

.feature-item:hover {
  background: var(--panel-hover);
}

.feature-wrapper {
  border-radius: 4px;
  overflow: hidden;
}

.feature-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.feature-properties {
  padding: 0 8px 8px;
  background: var(--panel-surface);
}

.feature-properties :deep(.ant-descriptions-bordered .ant-descriptions-item-label) {
  width: 40%;
  word-break: break-all;
}

.feature-properties :deep(.ant-descriptions-bordered .ant-descriptions-item-content) {
  word-break: break-all;
}

.property-value {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.feature-properties-empty {
  padding: 8px;
  background: var(--panel-surface);
}

.feature-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  margin-right: 8px;
}

.feature-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.feature-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.filter-empty {
  margin: 24px 0;
}

:deep(.ant-collapse-header) {
  padding: 10px 12px !important;
  align-items: center !important;
}

:deep(.ant-collapse-header-text) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

:deep(.ant-collapse-content-box) {
  padding: 0 12px 12px !important;
}

:deep(.ant-list-item) {
  border-bottom: none !important;
  padding: 0 !important;
}

:deep(.ant-list-pagination) {
  margin-top: 8px !important;
  margin-bottom: 0 !important;
  text-align: center;
}

:deep(.ant-pagination) {
  margin: 0;
}

:deep(.ant-empty) {
  margin: 32px 0;
}
</style>
