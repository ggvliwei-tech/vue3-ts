/**
 * Admin 管理后台 - 角色管理 API
 */

import { get, post, put, del } from '@project/shared/request'

// ========== 类型定义 ==========

/** 角色基础信息 */
export interface Role {
  id: number
  code: string
  name: string
  description: string | null
  status: number
  createTime: number
}

/** 角色详情（包含权限信息） */
export interface RoleDetail extends Role {
  permissions: Array<{ id: number; code: string; name: string; module: string }>
}

/** 创建角色参数 */
export interface CreateRoleParams {
  code: string
  name: string
  description?: string
  status?: number
  permissionCodes?: string[]
}

/** 更新角色参数 */
export interface UpdateRoleParams {
  name?: string
  description?: string
  status?: number
}

/** 分页响应 */
export interface PageRes<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

// ========== API ==========

/** 分页查询角色列表 */
export function listRoles(params?: { page?: number; pageSize?: number; keyword?: string }) {
  return get<PageRes<Role>>('/api/v1/admin/role', { params })
}

/** 查询全部启用的角色（用于下拉框） */
export function listEnabledRoles() {
  return get<Role[]>('/api/v1/admin/role/enabled')
}

/** 角色详情 */
export function getRoleDetail(id: number) {
  return get<RoleDetail>(`/api/v1/admin/role/${id}`)
}

/** 创建角色 */
export function createRole(data: CreateRoleParams) {
  return post<Role>('/api/v1/admin/role', data)
}

/** 更新角色 */
export function updateRole(id: number, data: UpdateRoleParams) {
  return put<Role>(`/api/v1/admin/role/${id}`, data)
}

/** 删除角色 */
export function deleteRole(id: number) {
  return del<{ msg: string }>(`/api/v1/admin/role/${id}`)
}

/** 给角色分配权限（按权限ID，全量替换） */
export function assignPermissionsById(roleId: number, permissionIds: number[]) {
  return put<{ msg: string }>(`/api/v1/admin/role/${roleId}/permissions`, { permissionIds })
}

/** 给角色分配权限（按权限码，全量替换） */
export function assignPermissionsByCode(roleId: number, codes: string[]) {
  return put<{ msg: string }>(`/api/v1/admin/role/${roleId}/permissions/by-code`, { codes })
}
