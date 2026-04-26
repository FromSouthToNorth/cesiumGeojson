/* ==============================
 * App Store —— 全局应用状态
 * 管理 loading 遮罩，提供给 layouts/index.vue 的 Spin 组件
 * ============================== */

import { reactive } from 'vue';
import { defineStore } from 'pinia';

export const useAppStore = defineStore('app', () => {
  const state = reactive({
    loading: false,
    loadingText: '加载中...',
  });

  function setLoading(val: boolean, text = '加载中...') {
    state.loading = val;
    state.loadingText = text;
  }

  return {
    state,
    setLoading,
  };
});
