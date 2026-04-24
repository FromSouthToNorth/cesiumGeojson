/* ==============================
 * Cesium Store —— Viewer 单例管理
 * 持有唯一的 Cesium.Viewer 实例引用，提供 set/clear/has 方法
 * ============================== */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Viewer } from 'cesium'

export const useCesiumStore = defineStore('cesium', () => {
  /** Cesium Viewer 实例（初始化后赋值） */
  const viewer = ref<Viewer | null>(null)

  /** Viewer 是否就绪（非空且未被销毁） */
  const hasViewer = computed(() => {
    return !!viewer.value && !viewer.value.isDestroyed()
  })

  function setViewer(v: Viewer) {
    viewer.value = v
  }

  function clearViewer() {
    viewer.value = null
  }

  return {
    viewer,
    hasViewer,
    setViewer,
    clearViewer,
  }
})
