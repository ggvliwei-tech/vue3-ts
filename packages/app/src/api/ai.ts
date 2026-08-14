/**
 * AI 相关 API 模块
 */

import { get, post } from '@project/shared/request'

export interface ChatParams {
  question: string
  sessionId?: string
}

export interface ChatRes {
  data: string
}

export interface ChatHistoryRes {
  data: string
  sessionId: string
}

export interface CreateSessionRes {
  sessionId: string
}

export interface SessionItem {
  sessionId: string
  messageCount: number
}

/**
 * 单轮简单问答
 */
export function chat(data: ChatParams) {
  return post<ChatRes>('/api/v1/ai/chat', data)
}

/**
 * 多轮对话（带历史上下文）
 */
export function chatWithHistory(data: ChatParams) {
  return post<ChatHistoryRes>('/api/v1/ai/chat/history', data)
}

/**
 * RAG 知识库问答
 */
export function ragChat(data: ChatParams) {
  return post<ChatRes>('/api/v1/ai/rag', data)
}

/**
 * 创建会话 ID
 */
export function createSession() {
  return post<CreateSessionRes>('/api/v1/ai/session/create')
}

/**
 * PDF 上传到向量库
 */
export function uploadPdf(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return post('/api/v1/ai/upload/pdf', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

/**
 * 列出所有会话
 */
export function listSessions() {
  return get<SessionItem[]>('/api/v1/ai/sessions')
}

/**
 * 删除单个会话
 */
export function deleteSession(sessionId: string) {
  return post(`/api/v1/ai/session/${sessionId}/delete`)
}

/**
 * 清空所有会话历史
 */
export function clearSessions() {
  return post('/api/v1/ai/sessions/clear')
}
