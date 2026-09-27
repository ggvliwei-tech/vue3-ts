/**
 * SSE 流式输出工具
 * 使用 fetch + ReadableStream（因为需要携带 Authorization 头，EventSource 不支持）
 *
 * 本次重构：
 *  - token 参数变为可选；不传则从 **@project/shared/auth-storage** 读取
 *    （不走 AuthStore —— pinia 未激活时 useAuthStore() 会直接抛错）
 *  - 抽取通用消费逻辑为私有 consume()，消除两个函数的重复
 *
 * 注意本模块用原生 fetch，**绕开了 axios 拦截器**：401 不会自动刷新 token，
 * 只会抛 `SSE 请求失败: 401 Unauthorized`。调用方（AiChat.vue）需要靠这个文案
 * 自行识别并调用 refreshAccessToken 重试。这里**没有** on401 回调，
 * 调用方也拿不到状态码 —— 若将来要改善，应该让 consume() 在 401 时走统一刷新，
 * 而不是继续加关键词匹配。
 */

// 从共享模块中导入 getBaseURL 函数
import { getBaseURL } from '@project/shared'
// 认证状态统一从 auth-storage 读取
import { getToken } from '@project/shared/auth-storage'

// 定义流式回调函数的接口
export interface StreamCallbacks {
  /** 接收到数据块时的回调函数，参数为文本内容 */
  onChunk: (text: string) => void
  /** 流式传输完成时的回调函数 */
  onDone: () => void
  /** 发生错误时的回调函数，参数为错误对象 */
  onError: (error: Error) => void
}

// ============== 内部：通用 SSE 消费 ==============

async function consume(
  url: string,
  token: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      signal,
    })

    if (!response.ok) {
      throw new Error(`SSE 请求失败: ${response.status} ${response.statusText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('无法读取响应流')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim()
          if (data) {
            callbacks.onChunk(data)
          }
        }
      }
    }

    callbacks.onDone()
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      callbacks.onDone()
      return
    }
    callbacks.onError(err as Error)
  }
}

/**
 * 取当前 token：显式传入优先，否则从统一存储层读取
 *
 * 不再经由 AuthStore：SSE 可能在任何上下文被调用，而 pinia 未激活时
 * useAuthStore() 会直接抛错；统一存储层则在任何环境都能安全读取。
 */
function resolveToken(explicit?: string): string {
  return explicit || getToken()
}

/**
 * 通过 fetch 消费 SSE 流式输出（不带历史）
 * @param question 用户提问
 * @param token 可选；不传则自动从 AuthStore 取
 * @param callbacks 回调
 * @param signal AbortSignal
 */
export async function consumeSSE(
  question: string,
  token: string | undefined,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${getBaseURL()}/api/v1/ai/stream?question=${encodeURIComponent(question)}`
  await consume(url, resolveToken(token), callbacks, signal)
}

/**
 * 通过 fetch 消费 SSE 流式输出（带 sessionId 上下文）
 * @param question 用户提问
 * @param sessionId 会话 ID
 * @param token 可选；不传则自动从 AuthStore 取
 * @param callbacks 回调
 * @param signal AbortSignal
 */
export async function consumeSSEWithHistory(
  question: string,
  sessionId: string,
  token: string | undefined,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const params = new URLSearchParams({ question, sessionId })
  const url = `${getBaseURL()}/api/v1/ai/stream/history?${params}`
  await consume(url, resolveToken(token), callbacks, signal)
}
