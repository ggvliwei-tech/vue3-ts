/**
 * Admin 管理后台用户相关 API
 */

// 从共享模块导入封装好的 get 和 post 请求方法
import { get, post } from '@project/shared/request'
// 从共享模块导入统一分页响应类型（单一来源：packages/shared/src/types.ts）
import type { PageRes } from '@project/shared'

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
    // 角色编码数组：['admin', 'editor'] / ['user']
    roles: string[]
    // 权限码数组：['user:list', 'book:create', ...]
    permissions: string[]
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
  // 当前用户拥有的角色编码列表（仅列表查询返回；findById 另有完整 roles/permissions 字段）
  roles?: string[]
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
 * 分页获取用户列表
 * 后端响应结构：{ list: User[]; total: number; page: number; pageSize: number }
 * QueryUserListDto 已有 page ?? 1 / pageSize ?? 20 默认值，params 全可选
 *
 * 筛选参数：
 *  - keyword：用户名模糊匹配
 *  - status：精确匹配 1 正常 / 0 禁用；不传查全部
 */
// 导出分页获取用户列表函数
export function getUserList(params?: {
  page?: number
  pageSize?: number
  keyword?: string
  status?: 0 | 1
}) {
  // 调用封装的 get 方法，传入分页 + 筛选查询参数，响应类型为 PageRes<User>
  return get<PageRes<User>>('/api/v1/user', { params })
}

/**
 * 强制用户下线
 */
// 强制下线响应结构
export interface KickRes { msg: string }
// 导出强制用户下线函数，接收用户 ID 作为参数
export function forceKick(userId: number) {
  // 调用封装的 post 方法，通过 URL 路径参数传递用户 ID，指定返回类型
  return post<KickRes>(`/api/v1/user/${userId}/kick`)
}

/**
 * 切换用户状态（启用/禁用）
 */
// 切换状态响应结构
export interface ToggleStatusRes { msg: string; status: number }
// 导出切换用户状态函数，接收用户 ID 作为参数
export function toggleUserStatus(userId: number) {
  // 调用封装的 post 方法，通过 URL 路径参数传递用户 ID，指定返回类型
  return post<ToggleStatusRes>(`/api/v1/user/${userId}/toggle-status`)
}
