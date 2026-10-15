/**
 * AI 相关 API 模块
 *
 * 只保留 AiChat.vue 实际使用的三个接口。对话本身走 SSE 流式通道
 * （`@/utils/sse` 的 consumeSSEWithHistory），不经由这里的 REST 接口。
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
