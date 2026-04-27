/* ==============================
 * GeoJSON Store —— GeoJSON 图层管理
 * 支持：多图层 CRUD、要素属性查看、显隐切换、定位飞行，默认加载 data/ 数据
 * ============================== */

import { ref, computed, toRaw, watch } from 'vue';
import { defineStore } from 'pinia';
import { GeoJsonDataSource, Color } from 'cesium';
import { message } from 'ant-design-vue';
import { useCesiumStore } from './cesiumStore';
import { hasZCoordinate } from '@/utils/geojson';

/** 自动分配的图层颜色（循环使用） */
const COLORS = ['#FF4D4F', '#52C41A', '#1890FF', '#FAAD14', '#722ED1', '#13C2C2', '#EB2F96', '#FA541C'];

/** public/data/ 目录下需要默认加载的 GeoJSON 文件名列表 */
const DEFAULT_DATA_FILES = ['mine_boundary_geojson.json', 'drilling_geojson.json', 'tunnel_geojson.json'];

/* ───────── 类型 ───────── */

export interface GeoJsonFeature {
  id: string;
  name: string;
  entity: any;
  properties: Record<string, any>;
}

export interface GeoJsonLayer {
  id: string;
  name: string;
  color: string;
  show: boolean;
  dataSource: GeoJsonDataSource;
  features: GeoJsonFeature[];
}

/* ───────── 帮助函数 ───────── */

/** 按索引取色 */
function pickColor(index: number) {
  return COLORS[index % COLORS.length];
}

/** 统一对实体应用颜色（支持 point/polygon/polyline/corridor/rectangle/ellipse） */
function applyEntityColor(entity: any, colorHex: string) {
  const cesiumColor = Color.fromCssColorString(colorHex);
  if (entity.point) {
    entity.point.color = cesiumColor;
  }
  if (entity.polygon) {
    entity.polygon.material = cesiumColor.withAlpha(0.6);
    entity.polygon.outline = true;
    entity.polygon.outlineColor = cesiumColor.withAlpha(1);
  }
  if (entity.polyline) {
    entity.polyline.material = cesiumColor.withAlpha(0.8);
  }
  if (entity.corridor) {
    entity.corridor.material = cesiumColor.withAlpha(0.6);
  }
  if (entity.rectangle) {
    entity.rectangle.material = cesiumColor.withAlpha(0.6);
    entity.rectangle.outline = true;
    entity.rectangle.outlineColor = cesiumColor.withAlpha(1);
  }
  if (entity.ellipse) {
    entity.ellipse.material = cesiumColor.withAlpha(0.6);
    entity.ellipse.outline = true;
    entity.ellipse.outlineColor = cesiumColor.withAlpha(1);
  }
}

/** 提取要素名称（优先使用属性中的 name/title/id） */
function extractFeatureName(entity: any, index: number) {
  let name = entity.name;
  if (!name && entity.properties) {
    try {
      name =
        entity.properties.name?.getValue?.() ??
        entity.properties.title?.getValue?.() ??
        entity.properties.id?.getValue?.();
    } catch {
      // 忽略 Cesium 属性异常
    }
  }
  return name || `Feature ${index + 1}`;
}

/** 提取要素的所有自定义属性 */
function extractFeatureProperties(entity: any): Record<string, any> {
  const result: Record<string, any> = {};
  if (!entity.properties) return result;

  try {
    const names = entity.properties.propertyNames;
    for (let i = 0; i < names.length; i++) {
      const key = names[i];
      const prop = entity.properties[key];
      const value = typeof prop?.getValue === 'function' ? prop.getValue() : undefined;
      if (value !== undefined) {
        result[key] = value;
      }
    }
  } catch {
    // 忽略属性格式异常
  }
  return result;
}

/* ───────── Store ───────── */

export const useGeoJsonStore = defineStore('geojson', () => {
  const cesiumStore = useCesiumStore();
  const viewer = computed(() => cesiumStore.viewer);
  const layers = ref<GeoJsonLayer[]>([]);

  /** 添加图层并飞行到其范围 */
  function addLayer(name: string, dataSource: GeoJsonDataSource, color: string, features: GeoJsonFeature[]) {
    const layer: GeoJsonLayer = {
      id: name,
      name,
      color,
      show: true,
      dataSource,
      features,
    };
    layers.value.push(layer);
    const v = toRaw(viewer.value);
    if (v && !v.isDestroyed()) {
      v.flyTo(dataSource).catch(() => {});
    }
  }

  /** 移除指定图层（先更新 UI，再异步销毁 Cesium 资源） */
  function removeLayer(id: string) {
    const idx = layers.value.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const target = toRaw(layers.value[idx]);

    // 先移除 UI 层，避免 Cesium 同步销毁阻塞界面
    layers.value.splice(idx, 1);

    // 延迟销毁 Cesium 数据源，让浏览器先完成 UI 重绘
    const v = toRaw(viewer.value);
    if (v && !v.isDestroyed()) {
      setTimeout(() => {
        try {
          v.dataSources.remove(target.dataSource, true);
        } catch (err) {
          console.error('移除 Cesium 数据源失败:', err);
        }
      }, 0);
    }
  }

  /** 移除所有图层 */
  function removeAllLayers() {
    if (layers.value.length === 0) return;
    const targets = layers.value.map((l) => toRaw(l));
    layers.value = [];

    const v = toRaw(viewer.value);
    if (v && !v.isDestroyed()) {
      setTimeout(() => {
        for (const target of targets) {
          try {
            v.dataSources.remove(target.dataSource, true);
          } catch (err) {
            console.error('移除 Cesium 数据源失败:', err);
          }
        }
      }, 0);
    }
  }

  /** 飞行定位到图层 */
  function flyToLayer(id: string) {
    const target = layers.value.find((l) => l.id === id);
    if (target) {
      const v = toRaw(viewer.value);
      if (v && !v.isDestroyed()) {
        v.flyTo(toRaw(target).dataSource).catch(() => {});
      }
    }
  }

  /** 切换图层显隐 */
  function toggleLayerVisibility(id: string) {
    const layer = layers.value.find((l) => l.id === id);
    if (layer) {
      layer.show = !layer.show;
      // 仅对 Cesium 对象用 toRaw，确保 show 变更触发 Vue 响应式
      toRaw(layer).dataSource.show = layer.show;
    }
  }

  /** 批量切换所有图层显隐 */
  function toggleAllVisibility() {
    const targetShow = !layers.value.every((l) => l.show);
    layers.value.forEach((layer) => {
      if (layer.show !== targetShow) {
        toggleLayerVisibility(layer.id);
      }
    });
  }

  /** 飞行定位到单个要素 */
  function flyToFeature(entity: any) {
    const v = toRaw(viewer.value);
    if (v && !v.isDestroyed()) {
      v.flyTo(toRaw(entity)).catch(() => {});
    }
  }

  /* ───────── GeoJSON 数据加载 ───────── */

  /**
   * 加载 GeoJSON 数据为图层（内部共享逻辑）
   * @param name 图层名称
   * @param json 已解析的 GeoJSON 对象
   * @param color 可选颜色，不传则自动分配
   */
  async function loadGeoJsonData(name: string, json: any, color?: string) {
    const options = hasZCoordinate(json) ? undefined : { clampToGround: true };
    const c = color ?? pickColor(layers.value.length);
    const dataSource = await GeoJsonDataSource.load(json, options);
    dataSource.name = name;

    // 遍历实体，应用颜色并提取要素信息
    const features: GeoJsonFeature[] = [];
    const entities = dataSource.entities.values;
    entities.forEach((entity: any, idx: number) => {
      applyEntityColor(entity, c);
      const featureName = extractFeatureName(entity, idx);
      const properties = extractFeatureProperties(entity);
      features.push({
        id: `${name}_feature_${idx}`,
        name: featureName,
        entity,
        properties,
      });
    });

    // 添加到 Cesium 和列表
    const v = toRaw(viewer.value);
    if (v && !v.isDestroyed()) {
      v.dataSources.add(dataSource);
      addLayer(name, dataSource, c, features);
    } else {
      console.warn('Cesium Viewer 尚未初始化，无法加载 GeoJSON');
    }
    return features;
  }

  /** 解析并加载 GeoJSON 文件（上传入口） */
  async function loadGeoJson(file: File) {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const name = `${file.name}_${Date.now()}`;
      const color = pickColor(layers.value.length);
      const features = await loadGeoJsonData(name, json, color);
      if (features.length > 0) {
        message.success(`${file.name} 加载成功，共 ${features.length} 个要素`);
      } else {
        message.warning(`${file.name} 加载完成，但未识别到要素`);
      }
    } catch (err) {
      message.error(`${file.name} 加载失败`);
      console.error(err);
    }
  }

  /** 从 public/data/ 获取默认 GeoJSON 数据 */
  async function loadDefaultGeoJson() {
    const results = await Promise.allSettled(
      DEFAULT_DATA_FILES.map(async (filename) => {
        const resp = await fetch(`/data/${filename}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        const name = filename.replace(/\.(geojson|json)$/i, '');
        await loadGeoJsonData(name, json);
      }),
    );
    // 汇总加载结果
    const errors = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (errors.length > 0) {
      errors.forEach((e) => console.error('默认数据加载失败:', e.reason));
      message.warning(`${errors.length} 个默认数据文件加载失败`);
    } else if (results.length > 0) {
      message.success(`已加载 ${results.length} 个默认数据文件`);
    }
  }

  // Viewer 就绪后自动加载默认数据（仅一次）
  let loadedOnce = false;
  watch(
    () => cesiumStore.viewer,
    (v) => {
      if (v && !v.isDestroyed() && !loadedOnce) {
        loadedOnce = true;
        loadDefaultGeoJson();
      }
      if (!v) loadedOnce = false;
    },
  );

  return {
    layers,
    addLayer,
    removeLayer,
    removeAllLayers,
    flyToLayer,
    toggleLayerVisibility,
    toggleAllVisibility,
    flyToFeature,
    loadGeoJson,
  };
});
