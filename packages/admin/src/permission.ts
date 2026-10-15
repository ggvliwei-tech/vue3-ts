/**
 * Admin 权限同步模块
 *
 * 权限的唯一真源在后端（sys_role / sys_permission / sys_role_permission），
 * 前端只负责消费：登录时后端把当前用户的 permissions 一并下发，
 * 这里负责在启动时再拉一次最新值覆盖本地缓存。
 *
 * 为什么 admin 需要这个：
 * 此前 admin 端完全没有权限同步 —— roles / permissions 只在登录那一刻写入，
 * 之后管理员改了角色，**已登录的其他管理员**不会收到任何更新，
 * 必须重新登录才生效。期间要么看不到新授予的入口，
 * 要么继续看到已被收回的入口（多一层 403 或误导）。
 *
 * 注意：前端过滤只是体验层（不该看到的入口不展示），
 * 真正的安全边界在后端 PermissionsGuard。
 */
import { useAuthStore } from '@project/shared/stores/useAuthStore'
import { getUserProfile } from '@/api/user'

/**
 * 权限码常量：必须与 nest-db.sql 中 sys_permission.code 完全一致。
 *
 * 集中声明的原因与 app 端一致：权限码散落在各页面里手写字符串，
 * 拼错一个字母不会报错，只会表现为"这个按钮永远不出现"（v-permission 判定失败
 * 就把元素摘掉），排查时既没有报错也没有日志。收敛到一处后拼错至少能在类型上暴露。
 */
export const PERM = {
  /** 查看用户列表 */
  USER_LIST: 'user:list',
  /** 强制用户下线（踢出活跃会话） */
  USER_KICK: 'user:kick',
  /** 启用 / 禁用用户 */
  USER_TOGGLE_STATUS: 'user:toggle-status',
  /** 给用户分配角色 */
  USER_ROLE_ASSIGN: 'user-role:assign',
  /** 查看角色列表 */
  ROLE_LIST: 'role:list',
  /** 创建角色 */
  ROLE_CREATE: 'role:create',
  /** 修改角色 */
  ROLE_UPDATE: 'role:update',
  /** 删除角色 */
  ROLE_DELETE: 'role:delete',
  /** 给角色绑定 / 解绑权限 */
  ROLE_ASSIGN_PERMISSION: 'role:assign-permission',
  /** 查看权限码列表 */
  PERMISSION_LIST: 'permission:list',
  /** 新增权限码 */
  PERMISSION_CREATE: 'permission:create',
  /** 修改权限码 */
  PERMISSION_UPDATE: 'permission:update',
  /** 删除权限码 */
  PERMISSION_DELETE: 'permission:delete',
  /** 查看管理端审计日志 */
  ADMIN_AUDIT: 'admin:audit',
  /** 查看管理仪表盘 */
  DASHBOARD_VIEW: 'dashboard:view',
  /** 管理公共知识库（上传 / 删除文档） */
  AI_DOC_MANAGE: 'ai:doc:manage',
} as const

/**
 * 从后端拉取最新的 roles / permissions 覆盖本地缓存
 *
 * 失败时静默返回 false（不阻塞应用启动）：401 会由 request 层的
 * 刷新 / 登出回调统一处理，其他错误则沿用本地缓存的旧权限。
 */
export async function syncPermissions(): Promise<boolean> {
  const authStore = useAuthStore()
  if (!authStore.isLoggedIn) return false

  try {
    const res = await getUserProfile()
    const profile = res.data
    authStore.setUserInfo({
      id: profile.id,
      username: profile.username,
      status: profile.status,
      roles: profile.roles ?? [],
      permissions: profile.permissions ?? [],
    })
    return true
  } catch {
    return false
  }
}
