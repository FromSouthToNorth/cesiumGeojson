<script setup lang="ts">
/*
 * App.vue —— 根组件
 * 包装 Ant Design ConfigProvider，根据主题 store 动态切换亮/暗算法
 */

import { ConfigProvider, theme } from 'ant-design-vue';
import { useThemeStore } from '@/stores/themeStore';

const themeStore = useThemeStore()
</script>

<template>
  <ConfigProvider :theme="{ algorithm: themeStore.isDark ? theme.darkAlgorithm : theme.defaultAlgorithm }">
    <router-view />
  </ConfigProvider>
</template>
