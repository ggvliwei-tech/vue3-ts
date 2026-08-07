/**
 * App 前台应用入口文件
 * 创建 Vue 3 应用实例并挂载到 DOM
 */

import { createApp } from 'vue'
import 'vant/lib/index.css'
import App from './App.vue'
import router from './router'
import { setRefreshTokenCallback, setUnauthorizedCallback } from '@project/shared/request'
import { refreshToken } from '@/api/user'

// token 过期时尝试刷新 token
setRefreshTokenCallback((callback) => {
  refreshToken()
    .then((res) => {
      const newToken = res.data.data.accessToken
      localStorage.setItem('token', newToken)
      callback(newToken)
    })
    .catch(() => {
      // 刷新失败，清除 token 并跳转登录页
      localStorage.removeItem('token')
      callback(null)
      router.push('/login')
    })
})

// token 刷新失败后的兜底回调
setUnauthorizedCallback(() => {
  localStorage.removeItem('token')
  router.push('/login')
})

createApp(App).use(router).mount('#app')
