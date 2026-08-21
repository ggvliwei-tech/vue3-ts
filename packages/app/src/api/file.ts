/**
 * 文件相关 API 模块
 */

// 从共享请求模块中导入 get、post、del 方法
import { get, post, del } from '@project/shared/request'

// 定义文件数据接口
export interface FileItem {
  // 文件唯一标识
  id: number
  // 原始文件名
  originalName: string
  // 保存后的文件名
  saveName: string
  // 文件存储路径
  filePath: string
  // 文件访问 URL
  url: string
  // 文件 MIME 类型
  mimeType: string
  // 文件大小（字节）
  size: number
  // 存储类型（如 local、oss 等）
  storageType: string
  // 所属模块
  module: string
  // 上传用户 ID
  uploadUserId: number
  // 创建时间戳
  createTime: number
}

// 定义文件列表响应数据的接口
export interface FileListRes {
  // 文件数据数组
  list: FileItem[]
  // 总记录数
  total: number
  // 当前页码
  page: number
  // 每页条数
  limit: number
}

// 定义单文件上传响应数据的接口
export interface UploadRes {
  // 文件访问 URL
  url: string
  // 文件详细信息
  info: FileItem
}

// 定义多文件上传响应数据的接口
export interface UploadMultiRes {
  // 文件访问 URL 数组
  urls: string[]
  // 文件详细信息数组
  list: FileItem[]
}

/**
 * 分页查询文件列表
 * @param params - 分页参数（页码、每页条数、模块筛选）
 */
export function getFileList(params: { page: number; limit: number; module?: string }) {
  // 发送 GET 请求获取文件列表，通过 params 传递分页和模块参数
  return get<FileListRes>('/api/v1/file', { params })
}

/**
 * 单文件上传
 * @param file - 要上传的文件对象
 */
export function uploadFile(file: File) {
  // 创建 FormData 对象用于上传文件
  const formData = new FormData()
  // 将文件添加到 FormData 中，键名为 'file'
  formData.append('file', file)
  // 发送 POST 请求上传单文件，设置 Content-Type 为 multipart/form-data
  return post<UploadRes>('/api/v1/file/image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

/**
 * 多文件上传
 * @param files - 要上传的文件对象数组
 */
export function uploadFiles(files: File[]) {
  // 创建 FormData 对象用于上传多个文件
  const formData = new FormData()
  // 遍历文件数组，将每个文件添加到 FormData 中，键名均为 'files'
  files.forEach((file) => formData.append('files', file))
  // 发送 POST 请求上传多文件，设置 Content-Type 为 multipart/form-data
  return post<UploadMultiRes>('/api/v1/file/images', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

/**
 * 删除文件
 * @param id - 文件 ID
 */
export function deleteFile(id: number) {
  // 发送 DELETE 请求删除指定 ID 的文件
  return del(`/api/v1/file/${id}`)
}
