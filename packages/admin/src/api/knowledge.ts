/**
 * Admin 管理后台 - 公共知识库 API
 *
 * 对应服务端 AiDocAdminController（路由前缀 /admin/knowledge）。
 * 这里管的是**公共库**：传上去的 PDF 全站登录用户都能检索到，
 * 所以整个控制器只认 ai:doc:manage 一个权限码。
 * 用户自己的私有资料走 app 端的 /ai/upload/pdf，与本文件无关。
 */

import { get, post } from '@project/shared/request'

// ========== 类型定义 ==========

/** 公共知识库文档（文档粒度，不是切块粒度） */
export interface KnowledgeDoc {
  docId: string
  filename: string
  /** 该文档的切块数 */
  chunks: number
  /** 上传时间（毫秒时间戳） */
  uploadedAt: number
}

/** 上传结果 */
export interface UploadDocRes {
  docId: string
  chunks: number
}

/** 删除结果 */
export interface DeleteDocRes {
  msg: string
  /** 实际删除的切块数，0 表示该文档不存在 */
  removed: number
}

// ========== API ==========

/** 上传 PDF 到公共知识库 */
export function uploadDoc(file: File) {
  const formData = new FormData()
  // 键名必须是 file —— 与服务端 FileInterceptor('file') 一致
  formData.append('file', file)
  return post<UploadDocRes>('/api/v1/admin/knowledge/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

/** 列出公共知识库文档 */
export function listDocs() {
  // 服务端返回的是数组本身，不是分页结构（文档数量级由 Chroma metadata 决定，
  // 当前规模不需要分页；量大之后再说）
  return get<KnowledgeDoc[]>('/api/v1/admin/knowledge/documents')
}

/** 删除公共知识库文档（连同其全部切块） */
export function deleteDoc(docId: string) {
  return post<DeleteDocRes>(
    `/api/v1/admin/knowledge/documents/${encodeURIComponent(docId)}/delete`,
  )
}
