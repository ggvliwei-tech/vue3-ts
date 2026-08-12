import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/home',
  },
  {
    path: '/home',
    component: () => import('@/components/TabBarLayout.vue'),
    redirect: '/home/index',
    children: [
      {
        path: 'index',
        name: 'Home',
        component: () => import('@/views/home/Home.vue'),
        meta: { title: '首页' },
      },
      {
        path: 'profile',
        name: 'Profile',
        component: () => import('@/views/home/Profile.vue'),
        meta: { title: '我的' },
      },
    ],
  },
  // 认证模块
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/auth/Login.vue'),
    meta: { title: '登录' },
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/auth/Register.vue'),
    meta: { title: '注册' },
  },
  // 账本模块
  {
    path: '/account-book',
    name: 'AccountBook',
    component: () => import('@/views/book/AccountBook.vue'),
    meta: { title: '账本列表' },
  },
  // 文件模块
  {
    path: '/file-list',
    name: 'FileList',
    component: () => import('@/views/file/FileList.vue'),
    meta: { title: '文件管理' },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 路由守卫：未登录时跳转登录页
const whiteList = ['/login', '/register']

router.beforeEach((to) => {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : ''
  if (token) return true
  if (whiteList.includes(to.path)) return true
  return { path: '/login', query: { redirect: to.fullPath } }
})

export default router
