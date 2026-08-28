/**
 * Admin 管理后台 - 权限管理 API
 */

import { get, post, put, del } from '@project/shared/request'

// ========== 类型定义 ==========

/** 权限信息 */
export interface Permission {
  id: number
  code: string
  name: string
  module: string
  description: string | null
  createTime: number
}

/** 创建权限参数 */
export interface CreatePermissionParams {
  code: string
  name: string
  module: string
  description?: string
}

/** 更新权限参数 */
export interface UpdatePermissionParams {
  name?: string
  module?: string
  description?: string
}

/** 分页响应 */
export interface PageRes<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

// ========== API ==========

/** 分页查询权限列表 */
export function listPermissions(params?: {
  page?: number
  pageSize?: number
  keyword?: string
  module?: string
}) {
  return get<PageRes<Permission>>('/api/v1/admin/permission', { params })
}

/** 权限按模块分组（用于权限树） */
export function listPermissionsGrouped() {
  return get<Record<string, Permission[]>>('/api/v1/admin/permission/grouped')
}

/** 查询所有模块（用于筛选下拉框） */
export function listPermissionModules() {
  return get<string[]>('/api/v1/admin/permission/modules')
}

/** 权限详情 */
export function getPermissionDetail(id: number) {
  return get<Permission>(`/api/v1/admin/permission/${id}`)
}

/** 创建权限 */
export function createPermission(data: CreatePermissionParams) {
  return post<Permission>('/api/v1/admin/permission', data)
}

/** 更新权限 */
export function updatePermission(id: number, data: UpdatePermissionParams) {
  return put<Permission>(`/api/v1/admin/permission/${id}`, data)
}

/** 删除权限 */
export function deletePermission(id: number) {
  return del<{ msg: string }>(`/api/v1/admin/permission/${id}`)
}
