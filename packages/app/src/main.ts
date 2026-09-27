/**
 * App 前台应用入口文件
 * 创建 Vue 3 应用实例并挂载到 DOM
 */

// 从 vue 库中导入 createApp 函数，用于创建 Vue 应用实例
import { createApp } from 'vue'
// M1：引入 Pinia
import { createPinia } from 'pinia'
// 导入根组件 App.vue
import App from './App.vue'
// 导入路由配置
import router from './router'
// 统一认证刷新配置：single-flight 刷新 + 静默续期 + 跨标签页同步
import { configureAuth } from '@project/shared/token-refresh'
// 旧版 localStorage 键的一次性迁移
import { migrateLegacyStorage } from '@project/shared/auth-storage'
// M1：使用 AuthStore 统一管理 token / userInfo
import { useAuthStore } from '@project/shared/stores/useAuthStore'
// 导入用户相关的 refreshToken 接口函数
import { refreshToken } from '@/api/user'
// 导入权限同步函数（从后端拉取最新 roles/permissions）
import { syncPermissions } from '@/permission'
// 导入 v-permission 按钮级权限指令
import { permission as vPermission } from '@/directives/permission'

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

// 创建 Pinia 实例
const pinia = createPinia()

// 先把历史版本写在 localStorage 平铺键（token / username / roles / permissions）
// 上的登录态迁移到统一键，必须早于任何鉴权判断
migrateLegacyStorage()

// 配置认证刷新
//
// 此前 refreshToken 的回调在 main.ts 里单独实现了一份，与 request 拦截器的
// 401 刷新、AiChat.vue 自己的刷新三处并行且互不知情，会并发轮换同一个 RT，
// 被服务端判定为令牌盗用后强制下线。现在统一交给 token-refresh 管理。
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

// 创建 Vue 应用实例，注册 Pinia 和路由插件
const app = createApp(App)
app.use(pinia)
app.use(router)
// 注册 v-permission 指令，供页面做按钮级权限控制
app.directive('permission', vPermission)

// 挂载前先同步一次权限：
// 本地缓存的是上次登录时下发的权限，而 admin 后台随时可能改角色。
// 先拉最新的 roles/permissions 再渲染，可避免首屏用陈旧权限渲染出已被撤销的入口。
//
// 注意这里的 .finally 是**会阻塞挂载**的：syncPermissions 内部虽然吞掉了异常，
// 但 Promise 仍要等 profile 请求 settle 才回调，而 axios 默认超时 15s。
// 后端慢或网络差时首屏就是一段白屏（连 van-nav-bar 都还没有）。
// 注释写「不阻塞挂载」是不对的；要真非阻塞，得把 app.mount 移出 finally。
syncPermissions().finally(() => {
  // 挂载到 id 为 app 的 DOM 元素上
  app.mount('#app')
})
