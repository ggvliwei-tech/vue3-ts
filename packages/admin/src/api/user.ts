/**
 * Admin 管理后台用户相关 API
 */

import { get, post } from '@project/shared/request'

export interface LoginParams {
  username: string
  password: string
}

export interface LoginRes {
  accessToken: string
  userInfo: {
    id: number
    username: string
    status: number
  }
}

export interface RefreshTokenRes {
  accessToken: string
}

export interface User {
  id: number
  username: string
  status: number
  createTime: number
}

/**
 * 管理员登录
 */
export function login(data: LoginParams) {
  return post<LoginRes>('/api/v1/user/login', data)
}

/**
 * 退出登录
 */
export function logout() {
  return post('/api/v1/user/logout')
}

/**
 * 刷新 accessToken（refreshToken 通过 HttpOnly Cookie 自动携带）
 * skipRefresh: true 防止 refresh 请求自身 401 时再次触发刷新
 */
export function refreshToken() {
  return post<RefreshTokenRes>('/api/v1/user/refresh-token', undefined, { skipRefresh: true })
}

/**
 * 获取用户列表
 */
export function getUserList() {
  return get<User[]>('/api/v1/user')
}

/**
 * 强制用户下线
 */
export function forceKick(userId: number) {
  return post(`/api/v1/user/${userId}/kick`)
}

/**
 * 切换用户状态（启用/禁用）
 */
export function toggleUserStatus(userId: number) {
  return post(`/api/v1/user/${userId}/toggle-status`)
}
