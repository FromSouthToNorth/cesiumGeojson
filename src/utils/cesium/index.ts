/* ==============================
 * Viewer 工厂函数
 * 创建并初始化 Cesium.Viewer，设置地形和默认视野
 * ============================== */

import { Ion, Viewer, Rectangle, Terrain } from 'cesium'

import { useAppStore } from '@/stores/appStore'

/**
 * 创建 Cesium Viewer
 * @param container - 挂载容器 DOM 元素
 * @returns Viewer 实例
 */
export function createViewer(container: HTMLElement) {
  const appStore = useAppStore()
  appStore.setLoading(true, '正在加载Cesium...')
  Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN
  const terrain = Terrain.fromWorldTerrain()
  const viewer = new Viewer(container, {
    terrain,
    geocoder: false,
    animation: false,
    timeline: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
  })
  terrain.readyEvent.addEventListener(() => terrainEventHandler(viewer))

  return viewer
}

/**
 * 地形就绪回调：关闭 loading 遮罩，飞行至中国范围
 */
function terrainEventHandler(viewer: Viewer) {
  const appStore = useAppStore()
  appStore.setLoading(false)
  const chinaRectangle = Rectangle.fromDegrees(73.5, 18.0, 135.0, 53.5)
  viewer.camera.flyTo({ destination: chinaRectangle })
}
