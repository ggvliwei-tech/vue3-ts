/**
 * AI 相关 API 模块
 */

// 从共享请求模块中导入 get 和 post 方法
import { get, post } from '@project/shared/request'

// 定义 AI 聊天请求参数的接口
export interface ChatParams {
  // 用户提出的问题内容
  question: string
  // 会话 ID（可选，用于多轮对话）
  sessionId?: string
}

// 定义单轮聊天响应数据的接口
export interface ChatRes {
  // AI 返回的回答内容
  data: string
}

// 定义带历史记录的聊天响应数据的接口
export interface ChatHistoryRes {
  // AI 返回的回答内容
  data: string
  // 当前会话 ID
  sessionId: string
}

// 定义创建会话响应数据的接口
export interface CreateSessionRes {
  // 新创建的会话 ID
  sessionId: string
}

// 定义会话项数据的接口
export interface SessionItem {
  // 会话 ID
  sessionId: string
  // 该会话中的消息数量
  messageCount: number
}

// 定义获取最近会话响应数据的接口
export interface LastSessionRes {
  // 最近一次会话的 ID
  sessionId: string
}

/**
 * 单轮简单问答
 * @param data - 聊天参数（问题内容和可选的会话 ID）
 */
export function chat(data: ChatParams) {
  // 发送 POST 请求到简单问答接口
  return post<ChatRes>('/api/v1/ai/chat', data)
}

/**
 * 多轮对话（带历史上下文）
 * @param data - 聊天参数（问题内容和可选的会话 ID）
 */
export function chatWithHistory(data: ChatParams) {
  // 发送 POST 请求到带历史上下文的对话接口
  return post<ChatHistoryRes>('/api/v1/ai/chat/history', data)
}

/**
 * RAG 知识库问答
 * @param data - 聊天参数（问题内容和可选的会话 ID）
 */
export function ragChat(data: ChatParams) {
  // 发送 POST 请求到 RAG 知识库问答接口
  return post<ChatRes>('/api/v1/ai/rag', data)
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
 * PDF 上传到向量库
 * @param file - 要上传的 PDF 文件对象
 */
export function uploadPdf(file: File) {
  // 创建 FormData 对象用于上传 PDF 文件
  const formData = new FormData()
  // 将 PDF 文件添加到 FormData 中
  formData.append('file', file)
  // 发送 POST 请求将 PDF 上传到向量库，设置 Content-Type 为 multipart/form-data
  return post('/api/v1/ai/upload/pdf', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

/**
 * 列出所有会话
 */
export function listSessions() {
  // 发送 GET 请求获取用户的所有会话列表
  return get<SessionItem[]>('/api/v1/ai/sessions')
}

/**
 * 删除单个会话
 * @param sessionId - 要删除的会话 ID
 */
export function deleteSession(sessionId: string) {
  // 发送 POST 请求删除指定 ID 的会话
  return post(`/api/v1/ai/session/${sessionId}/delete`)
}

/**
 * 清空所有会话历史
 */
export function clearSessions() {
  // 发送 POST 请求清空所有会话历史记录
  return post('/api/v1/ai/sessions/clear')
}
