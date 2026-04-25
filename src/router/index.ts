/* ==============================
 * 路由配置
 * / → 重定向到 /cesium → Home.vue
 * 使用 createWebHistory（无 hash 模式）
 * ============================== */

import { createRouter, createWebHistory } from 'vue-router';
import Home from '@/views/Home.vue';
import Layout from '@/layouts/index.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      redirect: '/cesium',
      component: Layout,
      children: [
        {
          path: '/cesium',
          name: 'cesium',
          component: Home,
        },
      ],
    },
  ],
});

export default router;
