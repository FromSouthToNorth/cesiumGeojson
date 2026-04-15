import { ref, computed, watch, toRaw } from 'vue'
import { defineStore } from 'pinia'
import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cartesian3,
  ClippingPolygon,
  ClippingPolygonCollection,
  Color,
  HeightReference,
} from 'cesium'
import { message } from 'ant-design-vue'
import { useCesiumStore } from './cesiumStore'

export const useTerrainClipStore = defineStore('terrainClip', () => {
  const cesiumStore = useCesiumStore()
  const viewer = computed(() => cesiumStore.viewer)

  const enabled = ref(false)
  const inverse = ref(false)
  const positions = ref<Cartesian3[]>([])
  const isDrawing = ref(false)

  let handler: ScreenSpaceEventHandler | null = null
  let polylineEntity: any = null
  let pointEntities: any[] = []
  let lastPosition: Cartesian3 | null = null

  function isValidViewer(v: any): boolean {
    return v && !v.isDestroyed()
  }

  function startDraw() {
    const v = toRaw(viewer.value)
    if (!isValidViewer(v)) {
      message.warning('Cesium 尚未初始化')
      return
    }
    if (isDrawing.value) return
    clearDrawGraphics()
    positions.value = []
    isDrawing.value = true

    handler = new ScreenSpaceEventHandler(v.canvas)

    handler.setInputAction((movement: any) => {
      const v2 = toRaw(viewer.value)
      if (!isValidViewer(v2)) return
      const ray = v2.camera.getPickRay(movement.position)
      let cartesian = ray ? v2.scene.globe.pick(ray, v2.scene) : null
      if (!cartesian) {
        cartesian = v2.camera.pickEllipsoid(movement.position, v2.scene.globe.ellipsoid)
      }
      if (cartesian) {
        lastPosition = cartesian
        positions.value.push(cartesian)
        drawHelper()
      }
    }, ScreenSpaceEventType.LEFT_CLICK)

    handler.setInputAction((movement: any) => {
      const v2 = toRaw(viewer.value)
      if (!isValidViewer(v2)) return
      const ray = v2.camera.getPickRay(movement.position)
      let cartesian = ray ? v2.scene.globe.pick(ray, v2.scene) : null
      if (!cartesian) {
        cartesian = v2.camera.pickEllipsoid(movement.position, v2.scene.globe.ellipsoid)
      }
      if (cartesian && positions.value.length > 0) {
        const last = positions.value[positions.value.length - 1]
        const dist = Cartesian3.distance(cartesian, last)
        if (dist < 5) {
          finishDraw()
          return
        }
      }
      undoLastVertex()
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

    handler.setInputAction(() => {
      finishDraw()
    }, ScreenSpaceEventType.RIGHT_CLICK)
  }

  function undoLastVertex() {
    const v = toRaw(viewer.value)
    if (!isValidViewer(v)) return
    if (positions.value.length === 0) return
    positions.value.pop()
    lastPosition = positions.value.length > 0 ? positions.value[positions.value.length - 1] : null
    drawHelper()
  }

  function drawHelper() {
    const v = toRaw(viewer.value)
    if (!isValidViewer(v)) return
    if (polylineEntity) {
      v.entities.remove(polylineEntity)
      polylineEntity = null
    }
    pointEntities.forEach((e) => v.entities.remove(e))
    pointEntities = []

    positions.value.forEach((p) => {
      pointEntities.push(
        v.entities.add({
          position: p,
          point: {
            pixelSize: 8,
            color: Color.YELLOW,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        }),
      )
    })

    if (positions.value.length > 1) {
      polylineEntity = v.entities.add({
        polyline: {
          positions: [...positions.value, positions.value[0]],
          width: 2,
          material: Color.YELLOW,
          clampToGround: true,
        },
      })
    }
  }

  function finishDraw() {
    const v = toRaw(viewer.value)
    if (!isValidViewer(v)) return
    isDrawing.value = false
    if (handler) {
      handler.destroy()
      handler = null
    }
    if (positions.value.length < 3) {
      message.warning('请至少绘制3个点')
      clearDrawGraphics()
      positions.value = []
      return
    }
    applyClip()
  }

  function clearDrawGraphics() {
    const v = toRaw(viewer.value)
    if (!isValidViewer(v)) return
    if (polylineEntity) {
      v.entities.remove(polylineEntity)
      polylineEntity = null
    }
    pointEntities.forEach((e) => v.entities.remove(e))
    pointEntities = []
  }

  function applyClip() {
    const v = toRaw(viewer.value)
    if (!isValidViewer(v) || positions.value.length < 3) return
    v.scene.globe.depthTestAgainstTerrain = true
    const clippingPolygon = new ClippingPolygon({
      positions: positions.value,
    })
    v.scene.globe.clippingPolygons = new ClippingPolygonCollection({
      polygons: [clippingPolygon],
      inverse: inverse.value,
    })
    enabled.value = true
    clearDrawGraphics()
    message.success('地形裁切已应用')
  }

  function clearClip() {
    const v = toRaw(viewer.value)
    if (!isValidViewer(v)) return
    v.scene.globe.clippingPolygons = new ClippingPolygonCollection()
    v.scene.globe.depthTestAgainstTerrain = false
    clearDrawGraphics()
    positions.value = []
    enabled.value = false
  }

  function destroy() {
    if (handler) {
      handler.destroy()
      handler = null
    }
    clearDrawGraphics()
    const v = toRaw(viewer.value)
    if (isValidViewer(v)) {
      v.scene.globe.clippingPolygons = new ClippingPolygonCollection()
      v.scene.globe.depthTestAgainstTerrain = false
    }
    positions.value = []
    enabled.value = false
    isDrawing.value = false
    lastPosition = null
  }

  watch(
    () => cesiumStore.viewer,
    (newViewer, oldViewer) => {
      if (oldViewer && !newViewer) {
        destroy()
      }
    },
  )

  watch(inverse, () => {
    const v = toRaw(viewer.value)
    if (enabled.value && positions.value.length >= 3 && isValidViewer(v)) {
      applyClip()
    }
  })

  return {
    enabled,
    inverse,
    isDrawing,
    positions,
    startDraw,
    clearClip,
    undoLastVertex,
    destroy,
  }
})
