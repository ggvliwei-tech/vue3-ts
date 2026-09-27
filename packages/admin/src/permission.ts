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
