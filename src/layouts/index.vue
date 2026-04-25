<!--
  layouts/index.vue —— 全局布局
  使用 Ant Design Layout 包裹，Spin 全局加载遮罩由 appStore 控制
-->
<template>
  <Layout>
    <Spin :spinning="state.loading" :tip="state.loadingText">
      <router-view />
    </Spin>
  </Layout>
</template>

<script setup lang="ts">
import { Layout, Spin } from 'ant-design-vue';
import { useAppStore } from '@/stores/appStore';
const appStore = useAppStore();
const { state } = appStore;
</script>
