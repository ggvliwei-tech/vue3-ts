/**
 * Admin 管理后台用户相关 API
 */

// 从共享模块导入封装好的 get 和 post 请求方法
import { get, post } from '@project/shared/request'

// 定义登录请求参数的接口类型
export interface LoginParams {
  // 用户名
  username: string
  // 密码
  password: string
}

// 定义登录响应的接口类型
export interface LoginRes {
  // 访问令牌
  accessToken: string
  // 用户信息对象
  userInfo: {
    // 用户 ID
    id: number
    // 用户名
    username: string
    // 用户状态（1 正常，0 禁用等）
    status: number
  }
}

// 定义刷新 token 响应的接口类型
export interface RefreshTokenRes {
  // 新的访问令牌
  accessToken: string
}

// 定义用户信息的接口类型
export interface User {
  // 用户 ID
  id: number
  // 用户名
  username: string
  // 用户状态
  status: number
  // 创建时间（时间戳）
  createTime: number
}

/**
 * 管理员登录
 */
// 导出登录函数，接收登录参数，向服务器发送 POST 请求
export function login(data: LoginParams) {
  // 调用封装的 post 方法，发送登录请求并指定响应类型为 LoginRes
  return post<LoginRes>('/api/v1/user/login', data)
}

/**
 * 退出登录
 */
// 导出退出登录函数，向服务器发送 POST 请求
export function logout() {
  // 调用封装的 post 方法，发送退出登录请求
  return post('/api/v1/user/logout')
}

/**
 * 刷新 accessToken（refreshToken 通过 HttpOnly Cookie 自动携带）
 * skipRefresh: true 防止 Refresh 请求自身 401 时再次触发刷新
 */
// 导出刷新 token 函数
export function refreshToken() {
  // 调用封装的 post 方法，发送刷新 token 请求，skipRefresh 选项防止无限递归刷新
  return post<RefreshTokenRes>('/api/v1/user/refresh-token', undefined, { skipRefresh: true })
}

/**
 * 获取用户列表
 */
// 导出获取用户列表函数
export function getUserList() {
  // 调用封装的 get 方法，获取用户列表数据，指定响应类型为 User 数组
  return get<User[]>('/api/v1/user')
}

/**
 * 强制用户下线
 */
// 导出强制用户下线函数，接收用户 ID 作为参数
export function forceKick(userId: number) {
  // 调用封装的 post 方法，通过 URL 路径参数传递用户 ID
  return post(`/api/v1/user/${userId}/kick`)
}

/**
 * 切换用户状态（启用/禁用）
 */
// 导出切换用户状态函数，接收用户 ID 作为参数
export function toggleUserStatus(userId: number) {
  // 调用封装的 post 方法，通过 URL 路径参数传递用户 ID
  return post(`/api/v1/user/${userId}/toggle-status`)
}
