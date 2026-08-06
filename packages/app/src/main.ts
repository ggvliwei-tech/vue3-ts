/**
 * App 前台应用入口文件
 * 创建 Vue 3 应用实例并挂载到 DOM
 */

// 从 vue 库中导入 createApp 函数，用于创建 Vue 应用实例
import { createApp } from 'vue'
// 导入根组件 App.vue
import App from './App.vue'

// 创建 Vue 应用实例并将 App 组件挂载到 id 为 'app' 的 DOM 元素上
createApp(App).mount('#app')
