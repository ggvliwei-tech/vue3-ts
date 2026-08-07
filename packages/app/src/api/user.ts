/**
 * 用户相关 API 模块
 */

import { post } from '@project/shared/request'

export interface LoginParams {
  username: string
  password: string
}

export interface RegisterParams {
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

/**
 * 用户登录
 */
export function login(data: LoginParams) {
  return post<LoginRes>('/api/v1/user/login', data)
}

/**
 * 用户注册
 */
export function register(data: RegisterParams) {
  return post<LoginRes>('/api/v1/user/register', data)
}

/**
 * 刷新 accessToken（refreshToken 通过 HttpOnly Cookie 自动携带）
 */
export function refreshToken() {
  return post<RefreshTokenRes>('/api/v1/user/refresh-token')
}
