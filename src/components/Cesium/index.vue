<!--
  components/Cesium/index.vue —— Cesium 地图容器
  创建并持有 Viewer 实例，挂载工具箱、导航控件、地图交互（气泡 + 右键菜单）
-->
<template>
  <div ref="cesiumContainer" class="cesium-container">
    <Toolbox />
    <CesiumNavigation />
    <MapPopup
      :visible="popupVisible"
      :entity="popupTarget"
      :screen-pos="popupScreenPos"
      :style="popupStyle"
      @close="closePopup()"
      @update:style="onPopupStyleChange"
    />
    <MapContextMenu
      :visible="contextMenuVisible"
      :entity="contextMenuTarget"
      :pos="contextMenuPos"
      @close="closeContextMenu()"
      @action="handleContextAction"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, nextTick, toRaw } from 'vue';
import type { Viewer } from 'cesium';
import type { Cartesian3 } from 'cesium';
import { message } from 'ant-design-vue';
import { createViewer } from '@/utils/cesium/viewer';
import { useCesiumStore } from '@/stores/cesiumStore';
import { useGeoPolygonStore } from '@/stores/geoPolygonStore';
import { useGeoPathStore } from '@/stores/geoPathStore';
import { useGeoJsonStore } from '@/stores/geojsonStore';
import { useMapInteraction } from '@/utils/cesium/shared/useMapInteraction';
import type { ContextActionEvent } from '@/utils/cesium/shared/useMapInteraction';
import { useEntityMove } from '@/utils/cesium/shared/useEntityMove';
import type { PopupVariantKey } from './shared/popupVariants';
import Toolbox from './Toolbox.vue';
import CesiumNavigation from './CesiumNavigation.vue';
import MapPopup from './shared/MapPopup.vue';
import MapContextMenu from './shared/MapContextMenu.vue';

defineOptions({ name: 'CesiumIndex' });

const { setViewer, clearViewer } = useCesiumStore();
const cesiumContainer = ref<HTMLDivElement | null>(null);
const viewer = ref<Viewer | null>(null);

const cesiumViewer = computed(() => viewer.value);

/* ─── 地图交互 ─── */
const interaction = useMapInteraction({ viewer: cesiumViewer });

const {
  popupTarget,
  popupScreenPos,
  popupVisible,
  popupStyle,
  contextMenuTarget,
  contextMenuPos,
  contextMenuVisible,
  closePopup,
  closeContextMenu,
} = interaction;

/* ─── 实体移动 ─── */
const entityMove = useEntityMove({
  viewer: cesiumViewer,
  onConfirm: (id: string, newPositions: Cartesian3[]) => {
    const polyStore = useGeoPolygonStore();
    const pathStore = useGeoPathStore();
    if (polyStore.isMoving) {
      polyStore.applyMovePositions(id, newPositions);
    } else if (pathStore.isMoving) {
      pathStore.applyMovePositions(id, newPositions);
    }
  },
  onCancel: () => {
    useGeoPolygonStore().cancelMove();
    useGeoPathStore().cancelMove();
  },
});

onMounted(() => {
  if (cesiumContainer.value) {
    viewer.value = createViewer(cesiumContainer.value);
    setViewer(viewer.value);
    nextTick(() => {
      interaction.setup();
    });
  }
});

onUnmounted(() => {
  interaction.teardown();
  if (viewer.value && !viewer.value.isDestroyed()) {
    viewer.value.destroy();
  }
  clearViewer();
  viewer.value = null;
});

function onPopupStyleChange(val: PopupVariantKey) {
  popupStyle.value = val;
}

/* ==============================
 *  右键菜单动作处理
 * ============================== */

function handleContextAction(payload: ContextActionEvent) {
  const { action, entity } = payload;
  if (!entity) return;

  switch (action.id) {
    case 'flyTo':
      if (entity.type === 'geoPolygon') {
        useGeoPolygonStore().flyToPolygon(entity.polygon.id);
      } else if (entity.type === 'geoPath') {
        useGeoPathStore().flyToPath(entity.path.id);
      } else if (entity.type === 'geojson') {
        const v = toRaw(viewer.value);
        if (v && !v.isDestroyed()) v.flyTo(entity.entity).catch(() => {});
      }
      break;

    case 'edit':
      if (entity.type === 'geoPolygon') {
        useGeoPolygonStore().startEdit(entity.polygon.id);
      } else if (entity.type === 'geoPath') {
        useGeoPathStore().startEdit(entity.path.id);
      } else if (entity.type === 'geojson') {
        message.info('GeoJSON 要素不支持直接编辑顶点');
      }
      break;

    case 'move':
      if (entity.type === 'geoPolygon') {
        const store = useGeoPolygonStore();
        store.startMove(entity.polygon.id);
        entityMove.startMove({
          id: entity.polygon.id,
          positions: entity.polygon.positions,
          color: entity.polygon.color,
          type: 'geoPolygon',
        });
        message.info('点击地图新位置以移动多边形，右键/Esc取消');
      } else if (entity.type === 'geoPath') {
        const store = useGeoPathStore();
        store.startMove(entity.path.id);
        entityMove.startMove({
          id: entity.path.id,
          positions: entity.path.positions,
          color: entity.path.color,
          type: 'geoPath',
        });
        message.info('点击地图新位置以移动路径，右键/Esc取消');
      }
      break;

    case 'toggleVisibility':
      if (entity.type === 'geoPolygon') {
        useGeoPolygonStore().toggleVisibility(entity.polygon.id);
      } else if (entity.type === 'geoPath') {
        useGeoPathStore().toggleVisibility(entity.path.id);
      } else if (entity.type === 'geojson') {
        useGeoJsonStore().toggleLayerVisibility(entity.layer.id);
      }
      break;

    case 'analyzeSlope':
      if (entity.type === 'geoPolygon') {
        const ps = useGeoPolygonStore();
        ps.selectPolygon(entity.polygon.id);
        ps.analyzeSlope(entity.polygon.id);
      }
      break;

    case 'toggleClipping':
      if (entity.type === 'geoPolygon') {
        useGeoPolygonStore().toggleClipping(entity.polygon.id);
      }
      break;

    case 'playback':
      if (entity.type === 'geoPath') {
        const pStore = useGeoPathStore();
        pStore.selectPath(entity.path.id);
        pStore.startPlayback(entity.path);
      }
      break;

    case 'viewProperties':
      if (entity.type === 'geojson') {
        const props = entity.feature.properties;
        const lines = Object.entries(props)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');
        message.info({ content: lines || '无属性数据', duration: 4 });
      }
      break;

    case 'delete':
      if (entity.type === 'geoPolygon') {
        useGeoPolygonStore().removePolygon(entity.polygon.id);
        message.success(`已删除 ${entity.polygon.name}`);
      } else if (entity.type === 'geoPath') {
        useGeoPathStore().removePath(entity.path.id);
        message.success(`已删除 ${entity.path.name}`);
      } else if (entity.type === 'geojson') {
        entity.entity.show = false;
        message.success(`${entity.feature.name} 已隐藏`);
      }
      break;
  }
}
</script>

<style scoped>
.cesium-container {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  overscroll-behavior: none;
}
</style>
