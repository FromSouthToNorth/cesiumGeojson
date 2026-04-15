import { Ion, Viewer, Rectangle, Terrain } from 'cesium'

import { useAppStore } from '@/stores/appStore'

/**
 * 创建Cesium Viewer
 * @param container 容器元素
 * @param options 配置项 参考[https://cesium.com/learn/cesiumjs/ref-doc/Viewer.html#.ConstructorOptions]
 * @returns Viewer实例
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
    // selectedImageryProviderViewModel: false,
    navigationHelpButton: false,
  })
  terrain.readyEvent.addEventListener(() => terrainEventHandler(viewer))

  return viewer
}


/**
 * 地形加载完成事件处理函数
 * @param viewer Viewer实例
 * @param terrain 地形实例
 */
function terrainEventHandler(viewer: Viewer) {
  const appStore = useAppStore()
  appStore.setLoading(false)
  const chinaRectangle = Rectangle.fromDegrees(73.5, 18.0, 135.0, 53.5)
  viewer.camera.flyTo({ destination: chinaRectangle })
}
