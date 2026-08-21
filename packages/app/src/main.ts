/**
 * App 前台应用入口文件
 * 创建 Vue 3 应用实例并挂载到 DOM
 */

// 从 vue 库中导入 createApp 函数，用于创建 Vue 应用实例
import { createApp } from 'vue'
// 导入根组件 App.vue
import App from './App.vue'
// 导入路由配置
import router from './router'
// 从共享请求模块中导入设置 token 刷新和未授权回调的函数
import { setRefreshTokenCallback, setUnauthorizedCallback } from '@project/shared/request'
// 导入用户相关的 refreshToken 接口函数
import { refreshToken } from '@/api/user'

// 导入 Vant 命令式 API 组件的样式文件（VantResolver 按需加载不会自动引入这些样式）
// 导入 Dialog 对话框组件样式
import 'vant/es/dialog/style/index.mjs'
// 导入 Toast 轻提示组件样式
import 'vant/es/toast/style/index.mjs'
// 导入 Overlay 遮罩层组件样式
import 'vant/es/overlay/style/index.mjs'
// 导入 Popup 弹出层组件样式
import 'vant/es/popup/style/index.mjs'
// 导入 ImagePreview 图片预览组件样式
import 'vant/es/image-preview/style/index.mjs'

// 设置 token 过期时的刷新回调函数
// 当请求返回 401 时，会自动调用此函数尝试刷新 token
setRefreshTokenCallback((callback) => {
  // 调用 refreshToken 接口获取新的 token
  refreshToken()
    .then((res) => {
      // 从响应中提取新的 accessToken
      const newToken = res.data.data.accessToken
      // 将新 token 存储到 localStorage 中
      localStorage.setItem('token', newToken)
      // 通过回调通知请求模块使用新的 token 重试原请求
      callback(newToken)
    })
    .catch(() => {
      // 刷新失败时，清除本地存储的 token
      localStorage.removeItem('token')
      // 通知请求模块停止重试
      callback(null)
      // 跳转到登录页让用户重新登录
      router.push('/login')
    })
})

// 设置 token 刷新失败后的兜底回调
// 当无法通过刷新 token 恢复认证时调用此回调
setUnauthorizedCallback(() => {
  // 清除本地存储的 token
  localStorage.removeItem('token')
  // 跳转到登录页
  router.push('/login')
})

// 创建 Vue 应用实例，注册路由插件，并挂载到 id 为 app 的 DOM 元素上
createApp(App).use(router).mount('#app')
