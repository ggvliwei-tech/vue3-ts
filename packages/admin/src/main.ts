/**
 * Admin 管理后台应用入口文件
 */

// 从 vue 库导入 createApp 函数，用于创建 Vue 应用实例
import { createApp } from 'vue'
// 引入 Pinia 状态管理
import { createPinia } from 'pinia'
// 导入根组件 App.vue
import App from './App.vue'
// 导入路由实例
import router from './router'
// 统一认证刷新配置：single-flight 刷新 + 静默续期 + 跨标签页同步
import { configureAuth } from '@project/shared/token-refresh'
// 使用 AuthStore 统一管理 token / userInfo
import { useAuthStore } from '@project/shared/stores/useAuthStore'
// 导入用户相关的 API 方法，其中包含 refreshToken 方法
import { refreshToken } from '@/api/user'
// 导入权限同步函数（从后端拉取最新 roles/permissions）
import { syncPermissions } from '@/permission'
// 导入 v-permission 按钮级权限指令
import { permission as vPermission } from '@/directives/permission'
// 给权限同步加等待上限，避免后端慢时首屏长时间白屏
import { settleWithin } from '@project/shared'

// Element Plus 命令式组件 CSS（auto-import 不会自动加载）
// 手动导入 Message 消息提示组件的 CSS 样式
import 'element-plus/es/components/message/style/css'
// 手动导入 MessageBox 消息弹框组件的 CSS 样式
import 'element-plus/es/components/message-box/style/css'

// 创建 Pinia 实例
const pinia = createPinia()

// 配置认证刷新
//
// 这里**不再**各自实现刷新逻辑：此前 main.ts 自己调 refreshToken()，
// 与 request 拦截器、AiChat 的刷新路径互不知情，并发刷新会被服务端的
// RT 复用检测判定为令牌盗用，把正常用户强制下线。
// 现在统一交给 token-refresh，它内部 single-flight 并负责静默续期排期。
configureAuth({
  refreshFn: refreshToken,
  // 会话确实失效：清状态并回登录页
  onAuthCleared: () => {
    useAuthStore(pinia).clearAuth()
    router.push('/login')
  },
  // 存储层的 token 变化（刷新 / 其他标签页登出）要同步到 Pinia 的响应式状态
  onTokenChanged: (newToken) => {
    useAuthStore(pinia).setToken(newToken)
  },
})

// 创建 Vue 应用实例，挂载根组件 App，注册 Pinia 和路由，并挂载到 id 为 app 的 DOM 元素上
// Pinia 必须在 router 之前注册，因为 router 可能用到 store
const app = createApp(App)
app.use(pinia)
app.use(router)
// 注册 v-permission 指令，供页面做按钮级权限控制
app.directive('permission', vPermission)

// 挂载前先同步一次权限：
// 本地缓存的是上次登录时下发的权限，而角色随时可能被改动。
// 先拉最新的 roles/permissions 再渲染，可避免首屏用陈旧权限渲染出已被撤销的入口
// （admin 此前完全没有这一步，权限只在登录那一刻写入，改角色必须重新登录才生效）。
//
// 但不能无限等：syncPermissions 内部吞掉了异常，Promise 要等 profile 请求 settle
// 才回调，而 axios 默认超时 15s —— 后端慢或不可达时首屏就是 15 秒白屏。
// 这里给等待加上限：正常情况下（后端几百毫秒内响应）仍然先拿到新权限再渲染，
// 超时则退回本地缓存放行，同步请求继续在后台跑，回来后会写进 store。
const PERMISSION_SYNC_TIMEOUT = 3000

settleWithin(syncPermissions(), PERMISSION_SYNC_TIMEOUT, () => {
  // 用 console 而不是 ElMessage：此刻 app 还没 mount，Element Plus 的
  // 消息组件没有挂载点，调用会静默失效
  console.warn(
    `[Admin] 权限同步超过 ${PERMISSION_SYNC_TIMEOUT}ms 未返回，先用本地缓存挂载；后台同步完成后权限会自动更新`,
  )
}).then(() => {
  app.mount('#app')
})
