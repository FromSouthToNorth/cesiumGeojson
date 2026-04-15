import { createRouter, createWebHistory } from 'vue-router'
import Home from '@/views/Home.vue'
import Layout from '@/layouts/index.vue'

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
          component: Home
        }
      ]
    }
  ]
})

export default router
