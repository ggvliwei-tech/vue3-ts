/**
 * 账本相关 API 模块
 */

// 从共享请求模块中导入 get、post、patch、del 方法
import { get, post, patch, del } from '@project/shared/request'

// 定义账本数据接口
export interface AccountBook {
  // 账本唯一标识
  id: number
  // 网站名称
  websiteName: string
  // 网站地址
  websiteUrl: string
  // 登录账号
  loginAccount: string
  // 登录密码
  loginPassword: string
  // 所属用户 ID
  userId: number
  // 创建时间戳
  createdAt: number
  // 更新时间戳
  updatedAt: number
}

// 定义新增账本请求参数的接口
export interface CreateAccountBookParams {
  // 网站名称
  websiteName: string
  // 网站地址
  websiteUrl: string
  // 登录账号
  loginAccount: string
  // 登录密码
  loginPassword: string
}

// 定义更新账本请求参数的接口（所有字段可选）
export interface UpdateAccountBookParams {
  // 网站名称（可选）
  websiteName?: string
  // 网站地址（可选）
  websiteUrl?: string
  // 登录账号（可选）
  loginAccount?: string
  // 登录密码（可选）
  loginPassword?: string
}

// 定义账本列表响应数据的接口
export interface AccountBookListRes {
  // 账本数据数组
  list: AccountBook[]
  // 总记录数
  total: number
  // 当前页码
  page: number
  // 每页条数
  limit: number
}

/**
 * 分页查询账本列表
 * @param params - 分页参数（页码和每页条数）
 */
export function getAccountBookList(params: { page: number; limit: number }) {
  // 发送 GET 请求获取账本列表，通过 params 传递分页参数
  return get<AccountBookListRes>('/api/v1/account-book', { params })
}

/**
 * 新增账本
 * @param data - 新增账本的参数
 */
export function createAccountBook(data: CreateAccountBookParams) {
  // 发送 POST 请求创建新账本，返回新建的账本数据
  return post<AccountBook>('/api/v1/account-book', data)
}

/**
 * 查询单个账本
 * @param id - 账本 ID
 */
export function getAccountBook(id: number) {
  // 发送 GET 请求根据 ID 获取单个账本详情
  return get<AccountBook>(`/api/v1/account-book/${id}`)
}

/**
 * 更新账本
 * @param id - 账本 ID
 * @param data - 更新的账本参数
 */
export function updateAccountBook(id: number, data: UpdateAccountBookParams) {
  // 发送 PATCH 请求更新指定 ID 的账本信息
  return patch<AccountBook>(`/api/v1/account-book/${id}`, data)
}

/**
 * 删除账本
 * @param id - 账本 ID
 */
export function deleteAccountBook(id: number) {
  // 发送 DELETE 请求删除指定 ID 的账本
  return del(`/api/v1/account-book/${id}`)
}
