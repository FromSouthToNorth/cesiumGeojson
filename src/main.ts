import { createApp } from 'vue'
import App from './App.vue'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import './style.css'

import router from './router'
import { createPinia } from 'pinia'


const app = createApp(App)
app.use(Antd)
app.use(router)
app.use(createPinia())

app.mount('#app')
