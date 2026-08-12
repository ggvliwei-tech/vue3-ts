/**
 * 文件相关 API 模块
 */

import { get, post, del } from '@project/shared/request'

export interface FileItem {
  id: number
  originalName: string
  saveName: string
  filePath: string
  url: string
  mimeType: string
  size: number
  storageType: string
  module: string
  uploadUserId: number
  createTime: number
}

export interface FileListRes {
  list: FileItem[]
  total: number
  page: number
  limit: number
}

export interface UploadRes {
  url: string
  info: FileItem
}

export interface UploadMultiRes {
  urls: string[]
  list: FileItem[]
}

/**
 * 分页查询文件列表
 */
export function getFileList(params: { page: number; limit: number; module?: string }) {
  return get<FileListRes>('/api/v1/file', { params })
}

/**
 * 单文件上传
 */
export function uploadFile(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return post<UploadRes>('/api/v1/file/image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

/**
 * 多文件上传
 */
export function uploadFiles(files: File[]) {
  const formData = new FormData()
  files.forEach((file) => formData.append('files', file))
  return post<UploadMultiRes>('/api/v1/file/images', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

/**
 * 删除文件
 */
export function deleteFile(id: number) {
  return del(`/api/v1/file/${id}`)
}
