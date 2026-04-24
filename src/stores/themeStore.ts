import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export type Theme = 'light' | 'dark'

export const useThemeStore = defineStore('theme', () => {
  const saved = localStorage.getItem('cesium-theme') as Theme | null
  const current = ref<Theme>(saved === 'light' || saved === 'dark' ? saved : 'dark')

  const isDark = computed(() => current.value === 'dark')

  function apply() {
    document.documentElement.setAttribute('data-theme', current.value)
  }

  function toggle() {
    current.value = current.value === 'dark' ? 'light' : 'dark'
    localStorage.setItem('cesium-theme', current.value)
    apply()
  }

  apply()

  return { current, isDark, toggle }
})
