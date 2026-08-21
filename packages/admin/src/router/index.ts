/**
 * Admin 管理后台路由配置
 */
// 从 vue-router 导入 createRouter 用于创建路由实例，导入 createWebHistory 用于创建 HTML5 history 模式的路由历史
import { createRouter, createWebHistory } from 'vue-router'
// 导入 vue-router 提供的路由记录原始类型定义
import type { RouteRecordRaw } from 'vue-router'

// 定义路由配置数组，类型为 RouteRecordRaw[]
const routes: RouteRecordRaw[] = [
  {
    // 定义登录页面的路由路径
    path: '/login',
    // 定义路由名称，用于编程式导航
    name: 'Login',
    // 使用动态导入实现路由懒加载，导入登录页面组件
    component: () => import('@/views/auth/Login.vue'),
    // 路由元信息，title 用于显示页面标题，public 标记为公开路由无需登录
    meta: { title: '登录', public: true },
  },
  {
    // 定义根路径，匹配所有非登录路由
    path: '/',
    // 使用动态导入加载管理后台布局组件
    component: () => import('@/components/AdminLayout.vue'),
    // 默认重定向到 dashboard 页面
    redirect: '/dashboard',
    // 定义子路由
    children: [
      {
        // 仪表盘页面路径，完整路径为 /dashboard
        path: 'dashboard',
        // 路由名称
        name: 'Dashboard',
        // 使用动态导入加载仪表盘页面组件
        component: () => import('@/views/dashboard/Dashboard.vue'),
        // 路由元信息，设置页面标题
        meta: { title: '仪表盘' },
      },
      {
        // 用户管理页面路径，完整路径为 /users
        path: 'users',
        // 路由名称
        name: 'UserManage',
        // 使用动态导入加载用户管理页面组件
        component: () => import('@/views/user/UserManage.vue'),
        // 路由元信息，设置页面标题
        meta: { title: '用户管理' },
      },
    ],
  },
]

// 创建路由实例
const router = createRouter({
  // 使用 HTML5 history 模式，URL 中不包含 # 号
  history: createWebHistory(),
  // 传入前面定义的路由配置
  routes,
})

// 路由守卫：在每次路由跳转前执行，检查用户登录状态
router.beforeEach((to) => {
  // 如果目标路由标记为公开路由（如登录页），直接放行
  if (to.meta.public) return true
  // 检查 localStorage 中是否存在 token，兼容非浏览器环境
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : ''
  // 如果存在 token，说明已登录，允许跳转
  if (token) return true
  // 否则未登录，重定向到登录页，并携带当前路径作为 redirect 参数以便登录后跳回
  return { path: '/login', query: { redirect: to.fullPath } }
})

// 导出路由实例，供 main.ts 使用
export default router
