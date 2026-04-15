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
