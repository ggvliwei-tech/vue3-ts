/**
 * 用户相关 API 模块
 */

// 从共享请求模块中导入 get / post 方法
import { get, post } from '@project/shared/request'

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
  // 手机号
  phone: string
}

// 定义忘记密码请求参数的接口
export interface ForgotPasswordParams {
  // 注册时使用的手机号
  phone: string
  // 短信验证码（6位数字）
  code: string
  // 新密码
  newPassword: string
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
    // 角色编码列表（后端登录时下发，用于 app 端权限渲染）
    roles?: string[]
    // 权限码列表（后端登录时下发，用于 app 端权限渲染）
    permissions?: string[]
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

// 定义当前用户信息的接口（与后端 /user/profile 返回结构一致）
export interface UserProfileRes {
  // 用户 ID
  id: number
  // 用户名
  username: string
  // 用户状态（0 禁用 / 1 启用）
  status: number
  // 手机号
  phone?: string
  // 角色编码列表（由 admin 后台分配）
  roles: string[]
  // 权限码列表（由 admin 后台通过「角色-权限」分配）
  permissions: string[]
}

/**
 * 获取当前登录用户信息（含最新的 roles / permissions）
 *
 * 权限是随 token 一起在登录时下发的，但 admin 后台随时可能调整角色，
 * 所以 app 启动时会再拉一次 profile 覆盖本地缓存，保证权限视图不陈旧。
 */
export function getUserProfile() {
  // 发送 GET 请求获取当前用户信息（后端为 @Get('profile')）
  return get<UserProfileRes>('/api/v1/user/profile')
}

/**
 * 通过手机号 + 短信验证码重置密码
 * @param data - 忘记密码参数（手机号 + 验证码 + 新密码）
 */
export function forgotPassword(data: ForgotPasswordParams) {
  // 发送 POST 请求到忘记密码接口
  return post<{ msg: string }>('/api/v1/user/forgot-password', data)
}
