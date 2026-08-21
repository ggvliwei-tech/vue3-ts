/**
 * SSE 流式输出工具
 * 使用 fetch + ReadableStream（因为需要携带 Authorization 头，EventSource 不支持）
 */

// 定义流式回调函数的接口
interface StreamCallbacks {
  // 接收到数据块时的回调函数，参数为文本内容
  onChunk: (text: string) => void
  // 流式传输完成时的回调函数
  onDone: () => void
  // 发生错误时的回调函数，参数为错误对象
  onError: (error: Error) => void
}

/**
 * 获取 API 基础地址
 * @returns 环境变量中配置的基础 URL，未配置时返回空字符串
 */
function getBaseURL(): string {
  // 从环境变量中读取 VITE_API_BASE_URL，未设置时使用空字符串作为默认值
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
  // 用户提出的问题内容
  question: string,
  // 用户认证 token
  token: string,
  // 回调函数集合
  callbacks: StreamCallbacks,
  // 可选的 AbortSignal 用于中断请求
  signal?: AbortSignal,
): Promise<void> {
  // 拼接请求 URL，将问题进行 URL 编码后作为查询参数
  const url = `${getBaseURL()}/api/v1/ai/stream?question=${encodeURIComponent(question)}`

  // 使用 try-catch 捕获可能的网络错误
  try {
    // 使用 fetch 发起 SSE 请求
    const response = await fetch(url, {
      // 使用 GET 方法请求
      method: 'GET',
      // 设置请求头
      headers: {
        // 携带 Bearer token 进行身份验证
        Authorization: `Bearer ${token}`,
        // 声明接受 SSE 格式的数据
        Accept: 'text/event-stream',
      },
      // 传入中断信号
      signal,
    })

    // 检查响应状态是否成功，失败则抛出错误
    if (!response.ok) {
      throw new Error(`SSE 请求失败: ${response.status} ${response.statusText}`)
    }

    // 获取响应体的读取器
    const reader = response.body?.getReader()
    // 如果无法获取读取器，则抛出错误
    if (!reader) {
      throw new Error('无法读取响应流')
    }

    // 创建文本解码器，用于将字节数据解码为字符串
    const decoder = new TextDecoder()
    // 初始化缓冲区，用于累积不完整的 SSE 数据行
    let buffer = ''

    // 进入无限循环，持续读取流式数据直到流结束
    while (true) {
      // 读取下一块数据，done 表示流是否结束，value 为字节数据
      const { done, value } = await reader.read()
      // 如果流已结束，则跳出循环
      if (done) break

      // 将读取到的字节数据解码为文本并追加到缓冲区中
      buffer += decoder.decode(value, { stream: true })

      // 按行分割缓冲区内容，解析 SSE 格式: "data: xxx\n\n"
      const lines = buffer.split('\n')
      // 保留最后一个可能不完整的行，等待下一次读取时补全
      buffer = lines.pop() || ''

      // 遍历所有完整的行
      for (const line of lines) {
        // 检查是否是 SSE 的 data 字段行
        if (line.startsWith('data:')) {
          // 提取 "data:" 后面的实际数据内容，并去除首尾空白
          const data = line.slice(5).trim()
          // 如果数据不为空，则调用 onChunk 回调函数将数据传递给调用方
          if (data) {
            callbacks.onChunk(data)
          }
        }
      }
    }

    // 流式数据读取完成后，调用 onDone 回调函数通知完成
    callbacks.onDone()
  } catch (err) {
    // 捕获到错误时，检查是否为请求被主动中断
    if ((err as Error).name === 'AbortError') {
      // 如果是中断错误，视为正常完成，调用 onDone 回调
      callbacks.onDone()
      return
    }
    // 否则调用 onError 回调函数，将错误信息传递给调用方
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
  // 用户提出的问题内容
  question: string,
  // 会话 ID，用于多轮对话上下文
  sessionId: string,
  // 用户认证 token
  token: string,
  // 回调函数集合
  callbacks: StreamCallbacks,
  // 可选的 AbortSignal 用于中断请求
  signal?: AbortSignal,
): Promise<void> {
  // 创建 URL 查询参数对象，包含问题和会话 ID
  const params = new URLSearchParams({
    question,
    sessionId,
  })
  // 拼接带历史上下文参数的请求 URL
  const url = `${getBaseURL()}/api/v1/ai/stream/history?${params}`

  // 使用 try-catch 捕获可能的网络错误
  try {
    // 使用 fetch 发起 SSE 请求
    const response = await fetch(url, {
      // 使用 GET 方法请求
      method: 'GET',
      // 设置请求头
      headers: {
        // 携带 Bearer token 进行身份验证
        Authorization: `Bearer ${token}`,
        // 声明接受 SSE 格式的数据
        Accept: 'text/event-stream',
      },
      // 传入中断信号
      signal,
    })

    // 检查响应状态是否成功，失败则抛出错误
    if (!response.ok) {
      throw new Error(`SSE 请求失败: ${response.status} ${response.statusText}`)
    }

    // 获取响应体的读取器
    const reader = response.body?.getReader()
    // 如果无法获取读取器，则抛出错误
    if (!reader) {
      throw new Error('无法读取响应流')
    }

    // 创建文本解码器，用于将字节数据解码为字符串
    const decoder = new TextDecoder()
    // 初始化缓冲区，用于累积不完整的 SSE 数据行
    let buffer = ''

    // 进入无限循环，持续读取流式数据直到流结束
    while (true) {
      // 读取下一块数据，done 表示流是否结束，value 为字节数据
      const { done, value } = await reader.read()
      // 如果流已结束，则跳出循环
      if (done) break

      // 将读取到的字节数据解码为文本并追加到缓冲区中
      buffer += decoder.decode(value, { stream: true })

      // 按行分割缓冲区内容，解析 SSE 数据
      const lines = buffer.split('\n')
      // 保留最后一个可能不完整的行，等待下一次读取时补全
      buffer = lines.pop() || ''

      // 遍历所有完整的行
      for (const line of lines) {
        // 检查是否是 SSE 的 data 字段行
        if (line.startsWith('data:')) {
          // 提取 "data:" 后面的实际数据内容，并去除首尾空白
          const data = line.slice(5).trim()
          // 如果数据不为空，则调用 onChunk 回调函数将数据传递给调用方
          if (data) {
            callbacks.onChunk(data)
          }
        }
      }
    }

    // 流式数据读取完成后，调用 onDone 回调函数通知完成
    callbacks.onDone()
  } catch (err) {
    // 捕获到错误时，检查是否为请求被主动中断
    if ((err as Error).name === 'AbortError') {
      // 如果是中断错误，视为正常完成，调用 onDone 回调
      callbacks.onDone()
      return
    }
    // 否则调用 onError 回调函数，将错误信息传递给调用方
    callbacks.onError(err as Error)
  }
}
