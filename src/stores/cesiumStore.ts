import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Viewer } from 'cesium'

export const useCesiumStore = defineStore('cesium', () => {
  const viewer = ref<Viewer | null>(null)

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
