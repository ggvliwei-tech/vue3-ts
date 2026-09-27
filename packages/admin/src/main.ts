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
// 统一认证刷新配置：single-flight 刷新 + 静默续期 + 跨标签页同步
import { configureAuth } from '@project/shared/token-refresh'
// 旧版 localStorage 键的一次性迁移
import { migrateLegacyStorage } from '@project/shared/auth-storage'
// M1：使用 AuthStore 统一管理 token / userInfo
import { useAuthStore } from '@project/shared/stores/useAuthStore'
// 导入用户相关的 API 方法，其中包含 refreshToken 方法
import { refreshToken } from '@/api/user'
// 导入权限同步函数（从后端拉取最新 roles/permissions）
import { syncPermissions } from '@/permission'
// 导入 v-permission 按钮级权限指令
import { permission as vPermission } from '@/directives/permission'

// Element Plus 命令式组件 CSS（auto-import 不会自动加载）
// 手动导入 Message 消息提示组件的 CSS 样式
import 'element-plus/es/components/message/style/css'
// 手动导入 MessageBox 消息弹框组件的 CSS 样式
import 'element-plus/es/components/message-box/style/css'

// 创建 Pinia 实例（M1）
const pinia = createPinia()

// 先把历史版本写在 localStorage 平铺键（token / username / roles / permissions）
// 上的登录态迁移到统一键，必须早于任何鉴权判断
migrateLegacyStorage()

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
// syncPermissions 内部已吞掉异常（未登录直接返回，请求失败沿用本地缓存），不会阻塞挂载。
syncPermissions().finally(() => {
  app.mount('#app')
})
