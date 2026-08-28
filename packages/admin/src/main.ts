/**
 * Admin 管理后台应用入口文件
 */

// 从 vue 库导入 createApp 函数，用于创建 Vue 应用实例
import { createApp } from 'vue'
// 引入 Pinia 状态管理（M1）
import { createPinia } from 'pinia'
// 导入根组件 App.vue
import App from './App.vue'
// 导入路由实例
import router from './router'
// 从共享模块导入请求工具中的刷新 token 回调、未授权回调设置函数以及静默续期工具
import { setRefreshTokenCallback, setUnauthorizedCallback, scheduleSilentRefresh } from '@project/shared/request'
// M1：使用 AuthStore 统一管理 token / userInfo
import { useAuthStore } from '@project/shared/stores/useAuthStore'
// 导入用户相关的 API 方法，其中包含 refreshToken 方法
import { refreshToken } from '@/api/user'

// Element Plus 命令式组件 CSS（auto-import 不会自动加载）
// 手动导入 Message 消息提示组件的 CSS 样式
import 'element-plus/es/components/message/style/css'
// 手动导入 MessageBox 消息弹框组件的 CSS 样式
import 'element-plus/es/components/message-box/style/css'

// 创建 Pinia 实例（M1）
const pinia = createPinia()

// token 过期时尝试刷新 token
// 设置刷新 token 的回调函数，当请求返回 401 时会触发此回调
setRefreshTokenCallback((callback) => {
  // 调用 refreshToken API 尝试刷新 token
  refreshToken()
    .then((res) => {
      // 从响应中获取新的 accessToken
      const newToken = res.data.accessToken
      // M1：写入 AuthStore（同时持久化到 sessionStorage）
      const authStore = useAuthStore(pinia)
      authStore.setToken(newToken)
      // 兼容旧读取方
      localStorage.setItem('token', newToken)
      // 调用回调函数，传入新 token 以重试原请求
      callback(newToken)
    })
    .catch(() => {
      // 刷新失败时清除 token
      const authStore = useAuthStore(pinia)
      authStore.clearAuth()
      localStorage.removeItem('token')
      localStorage.removeItem('username')
      localStorage.removeItem('roles')
      localStorage.removeItem('permissions')
      // 调用回调函数，传入 null 表示刷新失败
      callback(null)
      // 跳转到登录页面
      router.push('/login')
    })
})

// token 刷新失败后的兜底回调
// 设置未授权回调函数，当 token 刷新也失败时触发
setUnauthorizedCallback(() => {
  // 清除 token
  const authStore = useAuthStore(pinia)
  authStore.clearAuth()
  localStorage.removeItem('token')
  localStorage.removeItem('username')
  localStorage.removeItem('roles')
  localStorage.removeItem('permissions')
  // 跳转到登录页面
  router.push('/login')
})

// 启动静默续期：基于 JWT exp 提前 5 分钟主动刷新 access token
// 仅当用户已登录（token 存在）时才调度
if (localStorage.getItem('token')) {
  scheduleSilentRefresh(
    refreshToken,
    (newToken) => {
      // M1：写入 AuthStore
      const authStore = useAuthStore(pinia)
      authStore.setToken(newToken)
      // 兼容旧读取方
      localStorage.setItem('token', newToken)
    },
    5 * 60 * 1000, // 提前 5 分钟
  )
}

// 创建 Vue 应用实例，挂载根组件 App，注册 Pinia 和路由，并挂载到 id 为 app 的 DOM 元素上
// Pinia 必须在 router 之前注册，因为 router 可能用到 store
createApp(App).use(pinia).use(router).mount('#app')
