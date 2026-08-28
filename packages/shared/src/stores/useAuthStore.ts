/**
 * 全局认证状态（Pinia Store）
 *
 * M1 重构：把分散在 localStorage / 各 .vue 组件里的 token 与 userInfo
 * 统一收敛到一个 Pinia store，集中管理：
 *  - token（AccessToken）+ 持久化
 *  - userInfo（id / username / roles / permissions / status）
 *  - login / setToken / logout / setUserInfo / hasRole / hasPermission
 *
 * 调用方：
 *  - main.ts 在刷新 token 回调里调用 setToken / clearAuth
 *  - router.beforeEach 用 isLoggedIn / hasPermission 控制路由
 *  - 各业务页面用 store.userInfo / store.roles
 *
 * 注意：Pinia store 本身不持久化，token 通过 sessionStorage 备份
 * （不是 localStorage，避免多标签页共享陈旧 token 导致 401）
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface UserInfo {
  id: number
  username: string
  status?: number
  roles?: string[]
  permissions?: string[]
}

const TOKEN_STORAGE_KEY = 'auth.token'
const USER_STORAGE_KEY = 'auth.userInfo'

export const useAuthStore = defineStore('auth', () => {
  // ============ State ============
  const token = ref<string>('')
  const userInfo = ref<UserInfo | null>(null)

  // 初始化时从 sessionStorage 恢复（如果存在）
  // 不放 localStorage 是为了避免多标签页共用旧 token
  try {
    const cached = sessionStorage.getItem(TOKEN_STORAGE_KEY)
    if (cached) token.value = cached
    const userJson = sessionStorage.getItem(USER_STORAGE_KEY)
    if (userJson) userInfo.value = JSON.parse(userJson)
  } catch {
    // sessionStorage 在隐私模式可能抛错，吞掉即可
  }

  // ============ Getters ============
  const isLoggedIn = computed(() => !!token.value)
  const roles = computed(() => userInfo.value?.roles ?? [])
  const permissions = computed(() => userInfo.value?.permissions ?? [])

  // ============ Actions ============

  /** 写入 token（登录 / 刷新成功后调用） */
  function setToken(newToken: string): void {
    token.value = newToken
    try {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, newToken)
    } catch {
      // 静默失败
    }
  }

  /** 写入用户信息（登录成功后调用） */
  function setUserInfo(info: UserInfo | null): void {
    userInfo.value = info
    try {
      if (info) {
        sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(info))
      } else {
        sessionStorage.removeItem(USER_STORAGE_KEY)
      }
    } catch {
      // 静默失败
    }
  }

  /**
   * 登录完整流程：写入 token + userInfo
   * 后端 /user/login 返回的字段约定：
   *   { accessToken, refreshToken(写 HttpOnly cookie), sessionId, userInfo }
   */
  function login(payload: { accessToken: string; userInfo: UserInfo }): void {
    setToken(payload.accessToken)
    setUserInfo(payload.userInfo)
  }

  /** 清空所有认证状态 */
  function clearAuth(): void {
    token.value = ''
    userInfo.value = null
    try {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY)
      sessionStorage.removeItem(USER_STORAGE_KEY)
    } catch {
      // 静默失败
    }
  }

  /** 权限 / 角色判断 */
  function hasRole(role: string): boolean {
    return roles.value.includes(role)
  }

  function hasAnyRole(roleList: string[]): boolean {
    if (roleList.length === 0) return true
    return roleList.some((r) => roles.value.includes(r))
  }

  function hasPermission(perm: string): boolean {
    return permissions.value.includes(perm)
  }

  function hasAnyPermission(permList: string[]): boolean {
    if (permList.length === 0) return true
    return permList.some((p) => permissions.value.includes(p))
  }

  return {
    // state
    token,
    userInfo,
    // getters
    isLoggedIn,
    roles,
    permissions,
    // actions
    setToken,
    setUserInfo,
    login,
    clearAuth,
    hasRole,
    hasAnyRole,
    hasPermission,
    hasAnyPermission,
  }
})
