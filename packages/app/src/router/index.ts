// 从 vue-router 中导入创建路由的函数
import { createRouter, createWebHistory } from 'vue-router'
// 从 vue-router 中导入路由记录类型定义
import type { RouteRecordRaw } from 'vue-router'
// 导入权限码常量与权限判断工具
import { PERM, hasAnyPermission } from '@/permission'
// 认证状态统一从 auth-storage 读取（与 AuthStore / request 同源）
import { getToken } from '@project/shared/auth-storage'

// 定义路由配置数组
const routes: RouteRecordRaw[] = [
  {
    // 根路径配置
    path: '/',
    // 将根路径重定向到 /home
    redirect: '/home',
  },
  {
    // 首页模块的父级路由路径
    path: '/home',
    // 懒加载 TabBarLayout 布局组件作为首页的容器
    component: () => import('@/components/TabBarLayout.vue'),
    // 将 /home 重定向到 /home/index
    redirect: '/home/index',
    // 子路由配置
    children: [
      {
        // 首页子路由路径（相对于父路径）
        path: 'index',
        // 路由名称
        name: 'Home',
        // 懒加载首页组件
        component: () => import('@/views/home/Home.vue'),
        // 路由元信息，设置页面标题
        meta: { title: '首页' },
      },
      {
        // 个人中心子路由路径
        path: 'profile',
        // 路由名称
        name: 'Profile',
        // 懒加载个人中心组件
        component: () => import('@/views/home/Profile.vue'),
        // 路由元信息，设置页面标题
        meta: { title: '我的' },
      },
    ],
  },
  // 认证模块路由配置
  {
    // 登录页面路由路径
    path: '/login',
    // 路由名称
    name: 'Login',
    // 懒加载登录页面组件
    component: () => import('@/views/auth/Login.vue'),
    // 路由元信息，设置页面标题
    meta: { title: '登录' },
  },
  {
    // 注册页面路由路径
    path: '/register',
    // 路由名称
    name: 'Register',
    // 懒加载注册页面组件
    component: () => import('@/views/auth/Register.vue'),
    // 路由元信息，设置页面标题
    meta: { title: '注册' },
  },
  {
    // 忘记密码页面路由路径
    path: '/forgot-password',
    // 路由名称
    name: 'ForgotPassword',
    // 懒加载忘记密码页面组件
    component: () => import('@/views/auth/ForgotPassword.vue'),
    // 路由元信息，设置页面标题
    meta: { title: '找回密码' },
  },
  // 无权限提示页（路由守卫校验 meta.permissions 失败时跳转至此）
  {
    // 403 页面路由路径
    path: '/403',
    // 路由名称
    name: 'Forbidden',
    // 懒加载无权限页面组件
    component: () => import('@/views/error/Forbidden.vue'),
    // 路由元信息，设置页面标题
    meta: { title: '无访问权限' },
  },
  // 账本模块路由配置
  {
    // 账本列表页面路由路径
    path: '/account-book',
    // 路由名称
    name: 'AccountBook',
    // 懒加载账本列表页面组件
    component: () => import('@/views/book/AccountBook.vue'),
    // 路由元信息：页面标题 + 访问所需权限码（拥有任一即可）
    meta: { title: '账本列表', permissions: [PERM.BOOK_LIST] },
  },
  // 文件模块路由配置
  {
    // 文件管理页面路由路径
    path: '/file-list',
    // 路由名称
    name: 'FileList',
    // 懒加载文件管理页面组件
    component: () => import('@/views/file/FileList.vue'),
    // 路由元信息：页面标题 + 访问所需权限码
    meta: { title: '文件管理', permissions: [PERM.FILE_LIST] },
  },
  // AI 模块路由配置
  {
    // AI 聊天页面路由路径
    path: '/ai-chat',
    // 路由名称
    name: 'AiChat',
    // 懒加载 AI 聊天页面组件
    component: () => import('@/views/ai/AiChat.vue'),
    // 路由元信息：页面标题 + 访问所需权限码
    meta: { title: 'AI 聊天', permissions: [PERM.AI_CHAT] },
  },
  // 聊天室模块路由配置
  {
    // 房间列表页面路由路径
    path: '/rooms',
    // 路由名称
    name: 'RoomList',
    // 懒加载房间列表页面组件
    component: () => import('@/views/chat/RoomList.vue'),
    // 路由元信息：页面标题 + 访问所需权限码
    meta: { title: '聊天室', permissions: [PERM.CHAT_ROOM] },
  },
  {
    // 聊天室详情页面路由路径（动态路由参数 roomId）
    path: '/chat/:roomId',
    // 路由名称
    name: 'ChatRoom',
    // 懒加载聊天室页面组件
    component: () => import('@/views/chat/ChatRoom.vue'),
    // 路由元信息：页面标题 + 访问所需权限码
    meta: { title: '聊天', permissions: [PERM.CHAT_ROOM] },
  },
]

// 创建路由实例
const router = createRouter({
  // 使用 HTML5 History 模式的路由
  history: createWebHistory(),
  // 传入路由配置
  routes,
})

// 路由守卫：未登录时自动跳转到登录页
// 定义白名单路由，这些路由不需要登录即可访问
const whiteList = ['/login', '/register', '/forgot-password', '/403']

// 注册全局前置路由守卫，每次路由跳转前都会执行
router.beforeEach((to) => {
  // 从统一存储层获取 token（非浏览器环境返回空字符串）
  const token = getToken()

  // 未登录：白名单直接放行，其余重定向到登录页并携带原始路径，登录后可跳回
  if (!token) {
    if (whiteList.includes(to.path)) return true
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  // 已登录：校验路由声明的权限码（拥有任一即可放行）
  // 权限来自 admin 后台配置的「角色-权限」，登录时下发、启动时通过 syncPermissions 刷新
  const required = (to.meta.permissions as string[] | undefined) ?? []
  if (!hasAnyPermission(required)) {
    // 无权限跳 403，携带来源路径便于提示用户是哪个功能被拦下
    return { path: '/403', query: { from: to.fullPath } }
  }

  return true
})

// 导出路由实例供 main.ts 使用
export default router
