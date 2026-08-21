/**
 * 用户相关 API 模块
 */

// 从共享请求模块中导入 post 方法
import { post } from '@project/shared/request'

// 定义登录请求参数的接口
export interface LoginParams {
  // 用户名
  username: string
  // 密码
  password: string
}

// 定义注册请求参数的接口
export interface RegisterParams {
  // 用户名
  username: string
  // 密码
  password: string
}

// 定义登录响应数据的接口
export interface LoginRes {
  // 访问令牌
  accessToken: string
  // 用户信息对象
  userInfo: {
    // 用户 ID
    id: number
    // 用户名
    username: string
    // 用户状态（如 0 禁用 1 启用）
    status: number
  }
}

// 定义刷新 token 响应数据的接口
export interface RefreshTokenRes {
  // 新的访问令牌
  accessToken: string
}

/**
 * 用户登录
 * @param data - 登录参数（用户名和密码）
 */
export function login(data: LoginParams) {
  // 发送 POST 请求到登录接口，返回登录响应数据
  return post<LoginRes>('/api/v1/user/login', data)
}

/**
 * 用户注册
 * @param data - 注册参数（用户名和密码）
 */
export function register(data: RegisterParams) {
  // 发送 POST 请求到注册接口，返回注册响应数据
  return post<LoginRes>('/api/v1/user/register', data)
}

/**
 * 刷新 accessToken（refreshToken 通过 HttpOnly Cookie 自动携带）
 * skipRefresh: true 防止 refresh 请求自身 401 时再次触发刷新，避免无限递归
 */
export function refreshToken() {
  // 发送 POST 请求到刷新 token 接口，设置 skipRefresh 防止递归刷新
  return post<RefreshTokenRes>('/api/v1/user/refresh-token', undefined, { skipRefresh: true })
}
