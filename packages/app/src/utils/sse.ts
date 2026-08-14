/**
 * SSE 流式输出工具
 * 使用 fetch + ReadableStream（因为需要携带 Authorization 头，EventSource 不支持）
 */

interface StreamCallbacks {
  onChunk: (text: string) => void
  onDone: () => void
  onError: (error: Error) => void
}

/**
 * 获取 API 基础地址
 */
function getBaseURL(): string {
  return (import.meta as any).env?.VITE_API_BASE_URL ?? ''
}

/**
 * 通过 fetch 消费 SSE 流式输出
 * @param question 用户提问
 * @param token JWT token
 * @param callbacks 回调函数
 * @param signal 用于中断请求
 */
export async function consumeSSE(
  question: string,
  token: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${getBaseURL()}/api/v1/ai/stream?question=${encodeURIComponent(question)}`

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

      // 按行解析 SSE 格式: "data: xxx\n\n"
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // 保留最后一个不完整的行

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
 * 通过 fetch 消费 SSE 流式输出（带 sessionId 上下文）
 * @param question 用户提问
 * @param sessionId 会话 ID
 * @param token JWT token
 * @param callbacks 回调函数
 * @param signal 用于中断请求
 */
export async function consumeSSEWithHistory(
  question: string,
  sessionId: string,
  token: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const params = new URLSearchParams({
    question,
    sessionId,
  })
  const url = `${getBaseURL()}/api/v1/ai/stream/history?${params}`

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
