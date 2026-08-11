/**
 * 账本相关 API 模块
 */

import { get, post, patch, del } from '@project/shared/request'

export interface AccountBook {
  id: number
  websiteName: string
  websiteUrl: string
  loginAccount: string
  loginPassword: string
  userId: number
  createdAt: number
  updatedAt: number
}

export interface CreateAccountBookParams {
  websiteName: string
  websiteUrl: string
  loginAccount: string
  loginPassword: string
}

export interface UpdateAccountBookParams {
  websiteName?: string
  websiteUrl?: string
  loginAccount?: string
  loginPassword?: string
}

export interface AccountBookListRes {
  list: AccountBook[]
  total: number
  page: number
  limit: number
}

/**
 * 分页查询账本列表
 */
export function getAccountBookList(params: { page: number; limit: number }) {
  return get<AccountBookListRes>('/api/v1/account-book', { params })
}

/**
 * 新增账本
 */
export function createAccountBook(data: CreateAccountBookParams) {
  return post<AccountBook>('/api/v1/account-book', data)
}

/**
 * 查询单个账本
 */
export function getAccountBook(id: number) {
  return get<AccountBook>(`/api/v1/account-book/${id}`)
}

/**
 * 更新账本
 */
export function updateAccountBook(id: number, data: UpdateAccountBookParams) {
  return patch<AccountBook>(`/api/v1/account-book/${id}`, data)
}

/**
 * 删除账本
 */
export function deleteAccountBook(id: number) {
  return del(`/api/v1/account-book/${id}`)
}
