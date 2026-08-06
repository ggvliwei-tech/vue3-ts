/**
 * App 前台应用入口文件
 * 创建 Vue 3 应用实例并挂载到 DOM
 */

import { createApp } from 'vue'
import 'vant/lib/index.css'
import App from './App.vue'
import router from './router'

createApp(App).use(router).mount('#app')
