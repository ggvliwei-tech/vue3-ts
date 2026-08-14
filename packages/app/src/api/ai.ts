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
  return post<ChatRes>('/ai/chat', data)
}

/**
 * 多轮对话（带历史上下文）
 */
export function chatWithHistory(data: ChatParams) {
  return post<ChatHistoryRes>('/ai/chat/history', data)
}

/**
 * RAG 知识库问答
 */
export function ragChat(data: ChatParams) {
  return post<ChatRes>('/ai/rag', data)
}

/**
 * 创建会话 ID
 */
export function createSession() {
  return post<CreateSessionRes>('/ai/session/create')
}

/**
 * PDF 上传到向量库
 */
export function uploadPdf(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return post('/ai/upload/pdf', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

/**
 * 列出所有会话
 */
export function listSessions() {
  return get<SessionItem[]>('/ai/sessions')
}

/**
 * 删除单个会话
 */
export function deleteSession(sessionId: string) {
  return post(`/ai/session/${sessionId}/delete`)
}

/**
 * 清空所有会话历史
 */
export function clearSessions() {
  return post('/ai/sessions/clear')
}
