/**
 * Admin 管理后台 - 用户角色分配 API
 */

import { get, put, post, del } from '@project/shared/request'

// ========== 类型定义 ==========

/** 角色（精简） */
export interface RoleBrief {
  id: number
  code: string
  name: string
  status: number
}

/** 用户角色信息 */
export interface UserRoleInfo {
  userId: number
  username: string
  roles: RoleBrief[]
}

/** 角色下的用户 */
export interface RoleUser {
  id: number
  username: string
  phone: string
  status: number
  createTime: number
}

/** 分页响应 */
export interface PageRes<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

// ========== API ==========

/** 查询用户的角色列表 */
export function getUserRoles(userId: number) {
  return get<UserRoleInfo>(`/api/v1/admin/user-role/user/${userId}`)
}

/** 查询角色下的用户列表 */
export function listRoleUsers(roleId: number, params?: { page?: number; pageSize?: number }) {
  return get<PageRes<RoleUser> & { roleId: number; roleCode: string }>(
    `/api/v1/admin/user-role/role/${roleId}/users`,
    { params },
  )
}

/** 给用户分配角色（全量替换） */
export function assignUserRoles(userId: number, roleIds: number[]) {
  return put<{ msg: string }>(`/api/v1/admin/user-role/user/${userId}`, { roleIds })
}

/** 给用户追加一个角色 */
export function addUserRole(userId: number, roleId: number) {
  return post<{ msg: string }>(`/api/v1/admin/user-role/user/${userId}/role/${roleId}`)
}

/** 移除用户的某个角色 */
export function removeUserRole(userId: number, roleId: number) {
  return del<{ msg: string }>(`/api/v1/admin/user-role/user/${userId}/role/${roleId}`)
}
