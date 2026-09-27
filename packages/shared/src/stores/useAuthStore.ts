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
 *  - router.beforeEach 用 isLoggedIn / hasPermission 控制路由
 *  - 各业务页面用 store.userInfo / store.roles
 *
 * 持久化统一交给 auth-storage（唯一真源）：
 * 早先 store 写 sessionStorage、而 request 拦截器与路由守卫读 localStorage，
 * 两处不一致导致新标签页必然 403（详见 auth-storage.ts 顶部说明）。
 * 现在读写都经过同一模块，Pinia 只负责响应式视图。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  clearAuth as clearStoredAuth,
  getToken,
  getUserInfo,
  setToken as persistToken,
  setUserInfo as persistUserInfo,
  type StoredUserInfo,
} from '../auth-storage'

/** 用户信息结构（与 auth-storage 的持久化结构一致） */
export type UserInfo = StoredUserInfo

export const useAuthStore = defineStore('auth', () => {
  // ============ State ============
  // 初始值直接取自统一存储层，与请求层 / 路由守卫读到的必然是同一份
  const token = ref<string>(getToken())
  const userInfo = ref<UserInfo | null>(getUserInfo())

  // ============ Getters ============
  const isLoggedIn = computed(() => !!token.value)
  const roles = computed(() => userInfo.value?.roles ?? [])
  const permissions = computed(() => userInfo.value?.permissions ?? [])

  // ============ Actions ============

  /** 写入 token（登录 / 刷新成功后调用） */
  function setToken(newToken: string): void {
    token.value = newToken
    persistToken(newToken)
  }

  /** 写入用户信息（登录成功 / 权限同步后调用） */
  function setUserInfo(info: UserInfo | null): void {
    userInfo.value = info
    persistUserInfo(info)
  }

  /**
   * 登录完整流程：写入 token + userInfo
   *
   * 后端 /user/login 的响应体**只有** `{ accessToken, userInfo }`
   * （见 modules/user/user.controller.ts 的 `return { accessToken, userInfo }`）。
   * refreshToken 与 sessionId 是通过 `res.cookie()` 下发的 HttpOnly Cookie，
   * 前端读不到、也不需要读 —— 刷新时浏览器自动携带。
   */
  function login(payload: { accessToken: string; userInfo: UserInfo }): void {
    setToken(payload.accessToken)
    setUserInfo(payload.userInfo)
  }

  /** 清空所有认证状态 */
  function clearAuth(): void {
    token.value = ''
    userInfo.value = null
    clearStoredAuth()
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
