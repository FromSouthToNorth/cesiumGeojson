import { ref, computed, watch, toRaw } from 'vue'
import { defineStore } from 'pinia'
import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cartesian2,
  Cartesian3,
  ClippingPolygon,
  ClippingPolygonCollection,
  Color,
  HeightReference,
} from 'cesium'
import type { Viewer } from 'cesium'
import { message } from 'ant-design-vue'
import { useCesiumStore } from './cesiumStore'

/* ───────── types ───────── */

interface ClipRegion {
  id: string
  name: string
  positions: Cartesian3[]
}

interface PersistedData {
  regions: { id: string; name: string; positions: number[][] }[]
  inverse: boolean
}

const STORAGE_KEY = 'cesium-terrain-clip'
const HISTORY_MAX = 30

/* ───────── store ───────── */

export const useTerrainClipStore = defineStore('terrainClip', () => {
  const cesiumStore = useCesiumStore()
  const viewer = computed(() => cesiumStore.viewer)

  /* ── reactive state ── */

  const enabled = ref(false)
  const inverse = ref(false)
  const isDrawing = ref(false)
  const isEditing = ref(false)

  const regions = ref<ClipRegion[]>([])
  const activeRegionId = ref<string | null>(null)
  /** linked to the active region's positions array (shared reference) */
  const positions = ref<Cartesian3[]>([])

  /* ── undo / redo ── */

  const history = ref<Cartesian3[][]>([])
  const historyIndex = ref(-1)

  const canUndo = computed(() => historyIndex.value > 0)
  const canRedo = computed(() => historyIndex.value < history.value.length - 1)
  const hasRegions = computed(() => regions.value.length > 0)

  /* ── drawing entities ── */

  let handler: ScreenSpaceEventHandler | null = null
  let polylineEntity: any = null
  let pointEntities: any[] = []

  /* ── editing entities ── */

  let editingHandler: ScreenSpaceEventHandler | null = null
  let editPolygonEntity: any = null
  let editPolylineEntity: any = null
  let editPointEntities: any[] = []
  let editMidpointEntities: any[] = []
  let dragState: { index: number } | null = null
  let lastMousePos: Cartesian2 | null = null

  /* ── undo / redo ── */

  function pushHistory() {
    const snap = positions.value.map((p) => Cartesian3.clone(p))
    history.value = history.value.slice(0, historyIndex.value + 1)
    history.value.push(snap)
    historyIndex.value = history.value.length - 1
    if (history.value.length > HISTORY_MAX) {
      history.value.shift()
      historyIndex.value--
    }
  }

  function undo() {
    if (historyIndex.value <= 0) return
    historyIndex.value--
    applyHistory(history.value[historyIndex.value])
    saveToStorage()
  }

  function redo() {
    if (historyIndex.value >= history.value.length - 1) return
    historyIndex.value++
    applyHistory(history.value[historyIndex.value])
    saveToStorage()
  }

  function applyHistory(snap: Cartesian3[]) {
    positions.value.length = 0
    snap.forEach((p) => positions.value.push(Cartesian3.clone(p)))
    if (isEditing.value) {
      drawEditGraphics()
    }
    syncGlobeClipping()
    if (isEditing.value) {
      drawEditGraphics()
    }
  }

  /* ── helpers ── */

  function genId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }

  function isValidViewer(v: any): boolean {
    return v && !v.isDestroyed()
  }

  function linkPositions(region: ClipRegion) {
    positions.value = region.positions
  }

  /* ── persistence ── */

  function saveToStorage() {
    const data: PersistedData = {
      regions: regions.value.map((r) => ({
        id: r.id,
        name: r.name,
        positions: r.positions.map((p) => [p.x, p.y, p.z]),
      })),
      inverse: inverse.value,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      /* quota exceeded – ignore */
    }
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const data: PersistedData = JSON.parse(raw)
      if (!data.regions?.length) return
      regions.value = data.regions.map((r) => ({
        id: r.id,
        name: r.name ?? '区域',
        positions: r.positions.map(([x, y, z]) => new Cartesian3(x, y, z)),
      }))
      inverse.value = data.inverse ?? false
      const last = regions.value[regions.value.length - 1]
      activeRegionId.value = last.id
      linkPositions(last)
    } catch {
      /* corrupt data – ignore */
    }
  }

  /* ========================= Drawing ========================= */

  function startDraw() {
    const v = toRaw(viewer.value)
    if (!isValidViewer(v)) {
      message.warning('Cesium 尚未初始化')
      return
    }
    if (isDrawing.value) return
    if (isEditing.value) stopEdit()

    const region: ClipRegion = { id: genId(), name: `区域 ${regions.value.length + 1}`, positions: [] }
    regions.value.push(region)
    activeRegionId.value = region.id
    linkPositions(region)

    clearDrawGraphics()
    isDrawing.value = true

    handler = new ScreenSpaceEventHandler(v.canvas)

    handler.setInputAction((movement: any) => {
      const v2 = toRaw(viewer.value)
      if (!isValidViewer(v2)) return
      const cartesian = pickGlobe(v2, movement.position)
      if (cartesian) {
        positions.value.push(Cartesian3.clone(cartesian))
        drawHelper()
      }
    }, ScreenSpaceEventType.LEFT_CLICK)

    handler.setInputAction((movement: any) => {
      const v2 = toRaw(viewer.value)
      if (!isValidViewer(v2)) return
      const cartesian = pickGlobe(v2, movement.position)
      if (cartesian && positions.value.length > 0) {
        const dist = Cartesian3.distance(cartesian, positions.value[positions.value.length - 1])
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

  function finishDraw() {
    isDrawing.value = false
    if (handler) {
      handler.destroy()
      handler = null
    }
    clearDrawGraphics()

    if (positions.value.length < 3) {
      message.warning('请至少绘制 3 个点')
      regions.value = regions.value.filter((r) => r.id !== activeRegionId.value)
      const prev = regions.value.length > 0 ? regions.value[regions.value.length - 1] : null
      activeRegionId.value = prev?.id ?? null
      positions.value = prev?.positions ?? []
      return
    }

    pushHistory()
    syncGlobeClipping()
    saveToStorage()
  }

  function cancelDraw() {
    isDrawing.value = false
    if (handler) {
      handler.destroy()
      handler = null
    }
    clearDrawGraphics()
    regions.value = regions.value.filter((r) => r.id !== activeRegionId.value)
    const prev = regions.value.length > 0 ? regions.value[regions.value.length - 1] : null
    activeRegionId.value = prev?.id ?? null
    positions.value = prev?.positions ?? []
    if (!prev) syncGlobeClipping()
  }

  function undoLastVertex() {
    if (positions.value.length === 0) return
    positions.value.pop()
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

    const pos = positions.value
    pos.forEach((p) => {
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
    if (pos.length > 1) {
      polylineEntity = v.entities.add({
        polyline: {
          positions: [...pos, pos[0]],
          width: 2,
          material: Color.YELLOW,
          clampToGround: true,
        },
      })
    }
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

  /* ========================= Clipping ========================= */

  function pickGlobe(v: any, pos: Cartesian2): Cartesian3 | null {
    const ray = v.camera.getPickRay(pos)
    let cartesian = ray ? v.scene.globe.pick(ray, v.scene) : null
    if (!cartesian) {
      cartesian = v.camera.pickEllipsoid(pos, v.scene.globe.ellipsoid)
    }
    return cartesian
  }

  function syncGlobeClipping() {
    const v = toRaw(viewer.value)
    if (!isValidViewer(v)) return

    const valid = regions.value.filter((r) => r.positions.length >= 3)
    if (valid.length === 0) {
      v.scene.globe.clippingPolygons = new ClippingPolygonCollection()
      v.scene.globe.depthTestAgainstTerrain = false
      enabled.value = false
      return
    }

    v.scene.globe.depthTestAgainstTerrain = true
    const polygons = valid.map((r) => new ClippingPolygon({ positions: r.positions }))
    v.scene.globe.clippingPolygons = new ClippingPolygonCollection({ polygons, inverse: inverse.value })
    enabled.value = true
  }

  /* ========================= Region management ========================= */

  function selectRegion(id: string) {
    if (isDrawing.value || isEditing.value) return
    const region = regions.value.find((r) => r.id === id)
    if (!region) return
    activeRegionId.value = region.id
    linkPositions(region)
  }

  function clearRegion(id: string) {
    const v = toRaw(viewer.value)
    if (!isValidViewer(v)) return
    if (isEditing.value) stopEdit()
    if (isDrawing.value) {
      cancelDraw()
      return
    }
    regions.value = regions.value.filter((r) => r.id !== id)
    if (activeRegionId.value === id) {
      const prev = regions.value.length > 0 ? regions.value[regions.value.length - 1] : null
      activeRegionId.value = prev?.id ?? null
      positions.value = prev?.positions ?? []
    }
    syncGlobeClipping()
    saveToStorage()
  }

  function clearAll() {
    const v = toRaw(viewer.value)
    if (!isValidViewer(v)) return
    if (isEditing.value) stopEdit()
    if (isDrawing.value) {
      cancelDraw()
      return
    }
    regions.value = []
    activeRegionId.value = null
    positions.value = []
    history.value.length = 0
    historyIndex.value = -1
    syncGlobeClipping()
    localStorage.removeItem(STORAGE_KEY)
  }

  /* ========================= Editing ========================= */

  function startEdit(regionId?: string) {
    const id = regionId ?? activeRegionId.value
    if (!id) return
    const region = regions.value.find((r) => r.id === id)
    if (!region || region.positions.length < 3) return

    if (activeRegionId.value !== id) {
      activeRegionId.value = id
      linkPositions(region)
    }

    // push a snapshot at the start of editing
    pushHistory()

    // 锁定相机：编辑期间禁用相机拖拽以避免与顶点拖拽冲突
    const v = toRaw(viewer.value)
    if (isValidViewer(v)) {
      v.scene.screenSpaceCameraController.enableInputs = false
    }

    isEditing.value = true
    drawEditGraphics()
    setupEditHandler()
    setupKeyboardListener()
  }

  function stopEdit() {
    // 恢复相机控制
    const v = toRaw(viewer.value)
    if (isValidViewer(v)) {
      v.scene.screenSpaceCameraController.enableInputs = true
    }

    isEditing.value = false
    clearEditGraphics()
    destroyEditHandler()
    teardownKeyboardListener()
    dragState = null
    // history stays so user can undo after exiting edit mode
  }

  /* ── edit graphics (in-place updates) ── */

  function clearEditGraphics() {
    const v = toRaw(viewer.value)
    if (!isValidViewer(v)) return
    const remove = (e: any) => v.entities.remove(e)
    if (editPolygonEntity) { remove(editPolygonEntity); editPolygonEntity = null }
    if (editPolylineEntity) { remove(editPolylineEntity); editPolylineEntity = null }
    editPointEntities.forEach(remove)
    editPointEntities = []
    editMidpointEntities.forEach(remove)
    editMidpointEntities = []
  }

  function drawEditGraphics() {
    const v = toRaw(viewer.value)
    if (!isValidViewer(v)) return
    clearEditGraphics()

    const pos = positions.value
    const n = pos.length

    editPolygonEntity = v.entities.add({
      polygon: {
        hierarchy: [...pos],
        material: Color.CYAN.withAlpha(0.12),
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
    })
    editPolylineEntity = v.entities.add({
      polyline: {
        positions: [...pos, pos[0]],
        width: 2,
        material: Color.CYAN,
        clampToGround: true,
      },
    })

    pos.forEach((p) => {
      editPointEntities.push(
        v.entities.add({
          position: p,
          point: {
            pixelSize: 11,
            color: Color.YELLOW,
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        }),
      )
    })

    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n
      const mid = Cartesian3.midpoint(pos[i], pos[next], new Cartesian3())
      editMidpointEntities.push(
        v.entities.add({
          position: mid,
          point: {
            pixelSize: 8,
            color: Color.LIME,
            outlineColor: Color.WHITE,
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        }),
      )
    }
  }

  /** In-place update during drag – avoids full rebuild */
  function updateEditVertex(index: number, pos: Cartesian3) {
    const ent = editPointEntities[index]
    if (ent) ent.position = pos

    if (editPolylineEntity) {
      editPolylineEntity.polyline.positions = [...positions.value, positions.value[0]]
    }
    if (editPolygonEntity) {
      editPolygonEntity.polygon.hierarchy = [...positions.value]
    }

    // update the two adjacent midpoints
    const n = positions.value.length
    const prev = (index - 1 + n) % n
    const next = (index + 1) % n

    if (editMidpointEntities[prev]) {
      const mp = Cartesian3.midpoint(positions.value[prev], positions.value[index], new Cartesian3())
      editMidpointEntities[prev].position = mp
    }
    if (editMidpointEntities[index]) {
      const mp = Cartesian3.midpoint(positions.value[index], positions.value[next], new Cartesian3())
      editMidpointEntities[index].position = mp
    }
  }

  /* ── edit interaction handlers ── */

  function setupEditHandler() {
    const v = toRaw(viewer.value)
    if (!isValidViewer(v)) return

    editingHandler = new ScreenSpaceEventHandler(v.canvas)

    // LEFT_DOWN – start dragging a vertex
    editingHandler.setInputAction((click: any) => {
      const v2 = toRaw(viewer.value)
      if (!isValidViewer(v2)) return
      const picked = v2.scene.pick(click.position)
      if (picked?.id) {
        const idx = editPointEntities.indexOf(picked.id)
        if (idx !== -1) {
          dragState = { index: idx }
          v2.canvas.style.cursor = 'grabbing'
        }
      }
    }, ScreenSpaceEventType.LEFT_DOWN)

    // MOUSE_MOVE – drag vertex AND cursor feedback
    editingHandler.setInputAction((movement: any) => {
      lastMousePos = movement.endPosition
      const v2 = toRaw(viewer.value)
      if (!isValidViewer(v2)) return

      // cursor feedback
      const picked = v2.scene.pick(movement.endPosition)
      if (picked?.id) {
        if (dragState) {
          v2.canvas.style.cursor = 'grabbing'
        } else if (editPointEntities.indexOf(picked.id) !== -1) {
          v2.canvas.style.cursor = 'grab'
        } else if (editMidpointEntities.indexOf(picked.id) !== -1) {
          v2.canvas.style.cursor = 'pointer'
        } else {
          v2.canvas.style.cursor = 'default'
        }
      } else {
        v2.canvas.style.cursor = 'default'
      }

      if (!dragState) return
      const cartesian = pickGlobe(v2, movement.endPosition)
      if (cartesian) {
        positions.value[dragState.index] = cartesian
        updateEditVertex(dragState.index, cartesian)
      }
    }, ScreenSpaceEventType.MOUSE_MOVE)

    // LEFT_UP – end drag
    editingHandler.setInputAction(() => {
      if (dragState) {
        dragState = null
        const v2 = toRaw(viewer.value)
        if (isValidViewer(v2)) v2.canvas.style.cursor = 'default'
        pushHistory()
        syncGlobeClipping()
        drawEditGraphics()
        saveToStorage()
      }
    }, ScreenSpaceEventType.LEFT_UP)

    // LEFT_CLICK on midpoint → add vertex
    editingHandler.setInputAction((click: any) => {
      if (dragState) return
      const v2 = toRaw(viewer.value)
      if (!isValidViewer(v2)) return
      const picked = v2.scene.pick(click.position)
      if (picked?.id) {
        const idx = editMidpointEntities.indexOf(picked.id)
        if (idx !== -1) {
          const next = (idx + 1) % positions.value.length
          const mid = Cartesian3.midpoint(positions.value[idx], positions.value[next], new Cartesian3())
          positions.value.splice(next, 0, mid)
          pushHistory()
          drawEditGraphics()
          syncGlobeClipping()
          drawEditGraphics()
          saveToStorage()
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK)

    // RIGHT_CLICK on vertex → delete
    editingHandler.setInputAction((click: any) => {
      const v2 = toRaw(viewer.value)
      if (!isValidViewer(v2)) return
      const picked = v2.scene.pick(click.position)
      if (picked?.id) {
        const idx = editPointEntities.indexOf(picked.id)
        if (idx !== -1) {
          removeVertexByIndex(idx)
        }
      }
    }, ScreenSpaceEventType.RIGHT_CLICK)
  }

  function destroyEditHandler() {
    if (editingHandler) {
      editingHandler.destroy()
      editingHandler = null
    }
  }

  /** Shared safe deletion: ensures polygon always has >= 3 vertices */
  function removeVertexByIndex(idx: number) {
    if (idx < 0 || idx >= positions.value.length) return
    if (positions.value.length <= 3) {
      message.warning('至少需要 3 个顶点，无法继续删除')
      return
    }
    positions.value.splice(idx, 1)
    pushHistory()
    drawEditGraphics()
    syncGlobeClipping()
    drawEditGraphics()
    saveToStorage()
  }

  /* ── keyboard shortcuts ── */

  let keyboardActive = false

  function onKeyDown(e: KeyboardEvent) {
    if (!isEditing.value) return

    // Escape → exit edit
    if (e.key === 'Escape') {
      stopEdit()
      return
    }

    // Delete / Backspace → remove picked vertex
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const pos = lastMousePos
      if (!pos) return
      const v = toRaw(viewer.value)
      if (!isValidViewer(v)) return
      const picked = v.scene.pick(pos)
      if (picked?.id) {
        const idx = editPointEntities.indexOf(picked.id)
        if (idx !== -1) {
          e.preventDefault()
          removeVertexByIndex(idx)
        }
      }
      return
    }

    // Ctrl+Z / Ctrl+Shift+Z undo/redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault()
      if (e.shiftKey) {
        redo()
      } else {
        undo()
      }
    }
  }

  function setupKeyboardListener() {
    if (keyboardActive) return
    keyboardActive = true
    window.addEventListener('keydown', onKeyDown)
  }

  function teardownKeyboardListener() {
    if (!keyboardActive) return
    keyboardActive = false
    window.removeEventListener('keydown', onKeyDown)
  }

  /* ========================= Lifecycle ========================= */

  function destroy() {
    if (handler) { handler.destroy(); handler = null }
    if (editingHandler) { editingHandler.destroy(); editingHandler = null }
    teardownKeyboardListener()
    clearDrawGraphics()
    clearEditGraphics()
    const v = toRaw(viewer.value)
    if (isValidViewer(v)) {
      v.scene.globe.clippingPolygons = new ClippingPolygonCollection()
      v.scene.globe.depthTestAgainstTerrain = false
    }
    regions.value = []
    activeRegionId.value = null
    positions.value = []
    history.value.length = 0
    historyIndex.value = -1
    enabled.value = false
    isDrawing.value = false
    isEditing.value = false
    dragState = null
    lastMousePos = null
  }

  /* ── auto-load on viewer ready ── */

  let loadedOnce = false

  watch(cesiumStore.viewer, (v) => {
    if (v && !v.isDestroyed() && !loadedOnce) {
      loadedOnce = true
      loadFromStorage()
      if (regions.value.length > 0) syncGlobeClipping()
    }
    if (!v) {
      destroy()
      loadedOnce = false
    }
  })

  watch(inverse, () => {
    if (hasRegions.value) {
      syncGlobeClipping()
      saveToStorage()
      if (isEditing.value) drawEditGraphics()
    }
  })

  /* ========================= exports ========================= */

  return {
    // state
    enabled, inverse, isDrawing, isEditing,
    regions, activeRegionId, positions,
    canUndo, canRedo, hasRegions,
    // drawing
    startDraw, cancelDraw, undoLastVertex,
    // regions
    selectRegion, clearRegion, clearAll,
    // editing
    startEdit, stopEdit,
    // undo / redo
    undo, redo,
    // lifecycle
    destroy,
  }
})
