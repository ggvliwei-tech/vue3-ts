/**
 * Admin 管理后台路由配置
 */
// 从 vue-router 导入 createRouter 用于创建路由实例，导入 createWebHistory 用于创建 HTML5 history 模式的路由历史
import { createRouter, createWebHistory } from 'vue-router'
// 导入 vue-router 提供的路由记录原始类型定义
import type { RouteRecordRaw } from 'vue-router'
// 认证状态统一从 auth-storage 读取（与 AuthStore / request 同源，避免"写 A 读 B"）
import { getToken, getUserInfo } from '@project/shared/auth-storage'

// 扩展 vue-router 的 meta 类型，添加自定义字段
declare module 'vue-router' {
  interface RouteMeta {
    // 页面标题（用于 AdminLayout 顶部显示）
    title?: string
    // 是否公开路由（如登录页），true 表示无需登录
    public?: boolean
    // 允许访问的角色编码（任一即可），未配置表示仅需登录
    roles?: string[]
    // 需要的权限码（任一即可），未配置表示不校验权限码
    permissions?: string[]
  }
}

// 定义路由配置数组，类型为 RouteRecordRaw[]
const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/auth/Login.vue'),
    meta: { title: '登录', public: true },
  },
  {
    path: '/403',
    name: 'Forbidden',
    component: () => import('@/views/error/Forbidden.vue'),
    meta: { title: '无权限' },
  },
  {
    path: '/',
    component: () => import('@/components/AdminLayout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/dashboard/Dashboard.vue'),
        meta: { title: '仪表盘' },
      },
      {
        // 用户管理：需要 user:list 权限码
        path: 'users',
        name: 'UserManage',
        component: () => import('@/views/user/UserManage.vue'),
        meta: { title: '用户管理', permissions: ['user:list'] },
      },
      {
        // 角色管理：需要 role:list 权限码
        path: 'roles',
        name: 'RoleManage',
        component: () => import('@/views/role/RoleManage.vue'),
        meta: { title: '角色管理', permissions: ['role:list'] },
      },
      {
        // 权限管理：需要 permission:list 权限码
        path: 'permissions',
        name: 'PermissionManage',
        component: () => import('@/views/permission/PermissionManage.vue'),
        meta: { title: '权限管理', permissions: ['permission:list'] },
      },
      {
        // 审计日志（管理端）：需要 admin:audit 权限码
        path: 'audit',
        name: 'AuditLog',
        component: () => import('@/views/audit/AuditLog.vue'),
        meta: { title: '审计日志', permissions: ['admin:audit', 'user:audit'] },
      },
    ],
  },
]

// 创建路由实例
const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 路由守卫：依次校验登录态、角色、权限码
router.beforeEach((to) => {
  // 1. 公开路由（登录页）直接放行
  if (to.meta.public) return true

  // 2. 校验登录态
  const token = getToken()
  if (!token) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  // 角色 / 权限与登录态取自同一份数据，不会出现"token 在但权限读不到"的错位
  const userInfo = getUserInfo()

  // 3. 校验角色（meta.roles 是 OR 语义：拥有任一即可）
  if (to.meta.roles && to.meta.roles.length > 0) {
    const userRoles = userInfo?.roles ?? []
    const hasRole = userRoles.some((r) => to.meta.roles!.includes(r))
    if (!hasRole) return { path: '/403' }
  }

  // 4. 校验权限码（meta.permissions 是 OR 语义：拥有任一即可）
  if (to.meta.permissions && to.meta.permissions.length > 0) {
    const userPerms = userInfo?.permissions ?? []
    const hasPerm = userPerms.some((p) => to.meta.permissions!.includes(p))
    if (!hasPerm) return { path: '/403' }
  }

  return true
})

// 导出路由实例，供 main.ts 使用
export default router
