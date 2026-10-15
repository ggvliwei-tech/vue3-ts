/**
 * AI 相关 API 模块
 *
 * 两类接口：
 *  - 会话：createSession / getLastSession / getSessionMessages。
 *    对话本身走 SSE 流式通道（`@/utils/sse` 的 consumeSSEWithHistory），
 *    不经由这里的 REST 接口。
 *  - 私有知识库：上传 / 列表 / 删除「我的资料」（user_docs_{userId}）。
 *    这些资料只有本人能检索，与 admin 维护的公共库相互隔离；
 *    两者在提问时都会被检索到，所以 app 端不需要（也不该有）查看公共库的入口。
 */

// 从共享请求模块中导入 get 和 post 方法
import { get, post } from '@project/shared/request'

// 定义创建会话响应数据的接口
export interface CreateSessionRes {
  // 新创建的会话 ID
  sessionId: string
}

// 定义获取最近会话响应数据的接口
export interface LastSessionRes {
  // 最近一次会话的 ID
  sessionId: string
}

/**
 * 创建会话 ID
 */
export function createSession() {
  // 发送 POST 请求创建新的会话，返回会话 ID
  return post<CreateSessionRes>('/api/v1/ai/session/create')
}

/**
 * 获取用户最近一次会话
 */
export function getLastSession() {
  // 发送 GET 请求获取用户最近一次会话信息，可能无会话时返回 null
  return get<LastSessionRes | null>('/api/v1/ai/session/last')
}

/**
 * 获取指定会话的历史消息
 * @param sessionId - 会话 ID
 */
export function getSessionMessages(sessionId: string) {
  // 发送 GET 请求获取指定会话的历史消息列表
  return get<Array<{ role: 'user' | 'assistant'; content: string }>>(`/api/v1/ai/session/${sessionId}/messages`)
}

// ===================== 私有知识库（我的资料）=====================

/** 我的资料（文档粒度，不是切块粒度） */
export interface MyDoc {
  docId: string
  filename: string
  /** 该文档的切块数 */
  chunks: number
  /** 上传时间（毫秒时间戳） */
  uploadedAt: number
}

/** 上传结果 */
export interface UploadMyDocRes {
  docId: string
  chunks: number
}

/** 删除结果 */
export interface DeleteMyDocRes {
  msg: string
  /** 实际删除的切块数，0 表示该文档不存在或不属于当前用户 */
  removed: number
}

/**
 * 上传 PDF 到「我的资料」
 *
 * 权限码是 ai:doc:private（不是 ai:chat）：这是「管理自己的资料」这件事的权限，
 * 与能否使用 AI 对话相互独立。
 * @param file - 要上传的 PDF 文件
 */
export function uploadPrivateDoc(file: File) {
  const formData = new FormData()
  // 键名必须是 file —— 与服务端 FileInterceptor('file') 一致
  formData.append('file', file)
  return post<UploadMyDocRes>('/api/v1/ai/upload/pdf', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

/** 列出「我的资料」 */
export function listPrivateDocs() {
  return get<MyDoc[]>('/api/v1/ai/documents')
}

/**
 * 删除「我的资料」中的一份文档（连同其全部切块）
 * @param docId - 文档 ID（列表项里的 docId）
 */
export function deletePrivateDoc(docId: string) {
  return post<DeleteMyDocRes>(`/api/v1/ai/documents/${encodeURIComponent(docId)}/delete`)
}
