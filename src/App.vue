<script setup lang="ts">
import { ConfigProvider, theme } from 'ant-design-vue';
import { useThemeStore } from '@/stores/themeStore';

const themeStore = useThemeStore()
</script>

<template>
  <ConfigProvider :theme="{ algorithm: themeStore.isDark ? theme.darkAlgorithm : theme.defaultAlgorithm }">
    <router-view />
  </ConfigProvider>
</template>
