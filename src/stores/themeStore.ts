/* ==============================
 * Theme Store —— 亮/暗主题切换
 * 通过 data-theme 属性控制 CSS 变量集，主题偏好持久化到 localStorage
 * ============================== */

import { ref, computed } from 'vue';
import { defineStore } from 'pinia';

export type Theme = 'light' | 'dark';

export const useThemeStore = defineStore('theme', () => {
  /** 从 localStorage 恢复上次主题，默认 dark */
  const saved = localStorage.getItem('cesium-theme') as Theme | null;
  const current = ref<Theme>(saved === 'light' || saved === 'dark' ? saved : 'dark');

  const isDark = computed(() => current.value === 'dark');

  /** 将当前主题应用到 <html> 的 data-theme 属性 */
  function apply() {
    document.documentElement.setAttribute('data-theme', current.value);
  }

  /** 切换亮/暗并持久化 */
  function toggle() {
    current.value = current.value === 'dark' ? 'light' : 'dark';
    localStorage.setItem('cesium-theme', current.value);
    apply();
  }

  // 初始化时立即应用主题
  apply();

  return { current, isDark, toggle };
});
