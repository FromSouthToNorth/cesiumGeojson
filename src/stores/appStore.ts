import { reactive } from 'vue'
import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', () => {
  const state = reactive({
    theme: 'light',
    loading: false,
    loadingText: '加载中...'
  })

  function setLoading(val: boolean, text = '加载中...') {
    state.loading = val
    state.loadingText = text
  }

  return {
    state,
    setLoading
  }
})
