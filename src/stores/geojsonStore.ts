import { ref, computed, toRaw } from 'vue'
import { defineStore } from 'pinia'
import { GeoJsonDataSource, Color } from 'cesium'
import { message } from 'ant-design-vue'
import { useCesiumStore } from './cesiumStore'
import { hasZCoordinate } from '@/utils/geojson'

const COLORS = [
  '#FF4D4F',
  '#52C41A',
  '#1890FF',
  '#FAAD14',
  '#722ED1',
  '#13C2C2',
  '#EB2F96',
  '#FA541C',
]

export interface GeoJsonFeature {
  id: string
  name: string
  entity: any
  properties: Record<string, any>
}

export interface GeoJsonLayer {
  id: string
  name: string
  color: string
  show: boolean
  dataSource: GeoJsonDataSource
  features: GeoJsonFeature[]
}

function pickColor(index: number) {
  return COLORS[index % COLORS.length]
}

function applyEntityColor(entity: any, colorHex: string) {
  const cesiumColor = Color.fromCssColorString(colorHex)
  if (entity.point) {
    entity.point.color = cesiumColor
  }
  if (entity.polygon) {
    entity.polygon.material = cesiumColor.withAlpha(0.6)
    entity.polygon.outline = true
    entity.polygon.outlineColor = cesiumColor.withAlpha(1)
  }
  if (entity.polyline) {
    entity.polyline.material = cesiumColor.withAlpha(0.8)
  }
  if (entity.corridor) {
    entity.corridor.material = cesiumColor.withAlpha(0.6)
  }
  if (entity.rectangle) {
    entity.rectangle.material = cesiumColor.withAlpha(0.6)
    entity.rectangle.outline = true
    entity.rectangle.outlineColor = cesiumColor.withAlpha(1)
  }
  if (entity.ellipse) {
    entity.ellipse.material = cesiumColor.withAlpha(0.6)
    entity.ellipse.outline = true
    entity.ellipse.outlineColor = cesiumColor.withAlpha(1)
  }
}

function extractFeatureName(entity: any, index: number) {
  let name = entity.name
  if (!name && entity.properties) {
    try {
      name =
        entity.properties.name?.getValue?.() ??
        entity.properties.title?.getValue?.() ??
        entity.properties.id?.getValue?.()
    } catch {
      // ignore
    }
  }
  return name || `Feature ${index + 1}`
}

function extractFeatureProperties(entity: any): Record<string, any> {
  const result: Record<string, any> = {}
  if (!entity.properties) return result

  try {
    const names = entity.properties.propertyNames
    for (let i = 0; i < names.length; i++) {
      const key = names[i]
      const prop = entity.properties[key]
      const value = typeof prop?.getValue === 'function' ? prop.getValue() : undefined
      if (value !== undefined) {
        result[key] = value
      }
    }
  } catch {
    // ignore malformed Cesium properties
  }
  return result
}

export const useGeoJsonStore = defineStore('geojson', () => {
  const cesiumStore = useCesiumStore()
  const viewer = computed(() => cesiumStore.viewer)
  const layers = ref<GeoJsonLayer[]>([])

  function addLayer(name: string, dataSource: GeoJsonDataSource, color: string, features: GeoJsonFeature[]) {
    const layer: GeoJsonLayer = {
      id: name,
      name,
      color,
      show: true,
      dataSource,
      features,
    }
    layers.value.push(layer)
    const v = toRaw(viewer.value)
    if (v && !v.isDestroyed()) {
      v.flyTo(dataSource).catch(() => { })
    }
  }

  function removeLayer(id: string) {
    const _layers = toRaw(layers.value)
    const target = _layers.find((l) => l.id === id)
    const _target = toRaw(target)
    if (_target) {
      try {
        const v = toRaw(viewer.value)
        if (v && !v.isDestroyed()) {
          v.dataSources.remove(_target.dataSource, true)
        }
      } catch (err) {
        console.error('移除 Cesium 数据源失败:', err)
      } finally {
        layers.value = _layers.filter((l) => l.id !== id)
      }
    }
  }

  function flyToLayer(id: string) {
    const _layers = toRaw(layers.value)
    const target = _layers.find((l) => l.id === id)
    if (target) {
      const v = toRaw(viewer.value)
      if (v && !v.isDestroyed()) {
        v.flyTo(target.dataSource).catch(() => { })
      }
    }
  }

  function toggleLayerVisibility(id: string) {
    const layer = toRaw(layers.value).find((l) => l.id === id)
    if (layer) {
      layer.show = !layer.show
      layer.dataSource.show = layer.show
    }
  }

  function flyToFeature(entity: any) {
    const v = toRaw(viewer.value)
    if (v && !v.isDestroyed()) {
      v.flyTo(toRaw(entity)).catch(() => { })
    }
  }

  async function loadGeoJson(file: File) {
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const options = hasZCoordinate(json) ? undefined : { clampToGround: true }
      const name = `${file.name}_${Date.now()}`
      const color = pickColor(layers.value.length)
      const dataSource = await GeoJsonDataSource.load(json, options)
      dataSource.name = name

      const features: GeoJsonFeature[] = []
      const entities = dataSource.entities.values
      entities.forEach((entity: any, idx: number) => {
        applyEntityColor(entity, color)
        const featureName = extractFeatureName(entity, idx)
        const properties = extractFeatureProperties(entity)
        features.push({
          id: `${name}_feature_${idx}`,
          name: featureName,
          entity,
          properties,
        })
      })

      const v = toRaw(viewer.value)
      if (v && !v.isDestroyed()) {
        v.dataSources.add(dataSource)
        addLayer(name, dataSource, color, features)
        message.success(`${file.name} 加载成功，共 ${features.length} 个要素`)
      } else {
        message.warning('Cesium Viewer 尚未初始化，无法加载 GeoJSON')
      }
    } catch (err) {
      message.error(`${file.name} 加载失败`)
      console.error(err)
    } finally {
    }
  }

  return {
    layers,
    addLayer,
    removeLayer,
    flyToLayer,
    toggleLayerVisibility,
    flyToFeature,
    loadGeoJson,
  }
})
