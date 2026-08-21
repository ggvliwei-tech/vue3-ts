// 从 vue-router 中导入创建路由的函数
import { createRouter, createWebHistory } from 'vue-router'
// 从 vue-router 中导入路由记录类型定义
import type { RouteRecordRaw } from 'vue-router'

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
  // 账本模块路由配置
  {
    // 账本列表页面路由路径
    path: '/account-book',
    // 路由名称
    name: 'AccountBook',
    // 懒加载账本列表页面组件
    component: () => import('@/views/book/AccountBook.vue'),
    // 路由元信息，设置页面标题
    meta: { title: '账本列表' },
  },
  // 文件模块路由配置
  {
    // 文件管理页面路由路径
    path: '/file-list',
    // 路由名称
    name: 'FileList',
    // 懒加载文件管理页面组件
    component: () => import('@/views/file/FileList.vue'),
    // 路由元信息，设置页面标题
    meta: { title: '文件管理' },
  },
  // AI 模块路由配置
  {
    // AI 聊天页面路由路径
    path: '/ai-chat',
    // 路由名称
    name: 'AiChat',
    // 懒加载 AI 聊天页面组件
    component: () => import('@/views/ai/AiChat.vue'),
    // 路由元信息，设置页面标题
    meta: { title: 'AI 聊天' },
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
const whiteList = ['/login', '/register']

// 注册全局前置路由守卫，每次路由跳转前都会执行
router.beforeEach((to) => {
  // 从 localStorage 中获取 token，兼容非浏览器环境
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : ''
  // 如果存在 token，说明已登录，允许正常跳转
  if (token) return true
  // 如果目标路由在白名单中，允许访问
  if (whiteList.includes(to.path)) return true
  // 否则重定向到登录页，并携带原始路径作为 redirect 参数，登录后可以跳回
  return { path: '/login', query: { redirect: to.fullPath } }
})

// 导出路由实例供 main.ts 使用
export default router
