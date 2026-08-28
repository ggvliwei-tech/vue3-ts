/**
 * useAIStream - AI 流式问答 composable（M3 重构）
 *
 * 从 AiChat.vue 抽出三处重复的 "SSE 流式消费 + token 过期自动刷新 + 重试"
 * 逻辑，统一封装为可复用的 composable。
 *
 * 用法：
 *   const { streaming, error, send, abort } = useAIStream({
 *     onChunk: (text) => { ... },     // 每个 chunk 到达
 *     onDone: () => { ... },          // 流完成
 *     onError: (err) => { ... },      // 流错误（已尝试过 token 刷新）
 *   })
 *   await send('问题', sessionId)     // 发起流式请求
 *   abort()                          // 中断
 *
 * token 来源：从 useAuthStore 自动获取，无需手动传
 * sessionId：调用方传入，未传则后端自动生成
 */
import { ref, onUnmounted } from 'vue'
import { useAuthStore } from '@project/shared/stores/useAuthStore'
import { consumeSSEWithHistory } from '@/utils/sse'

/** token 过期提示关键词（后端 SSE 错误消息识别） */
const TOKEN_EXPIRED_HINTS = ['Token', 'token', '登录已过期', '401', 'unauthorized']

export interface UseAIStreamOptions {
  /** 每个 SSE chunk 回调 */
  onChunk?: (text: string) => void
  /** 流完成回调（成功 / 中断） */
  onDone?: () => void
  /** 流错误回调（已尝试 token 刷新） */
  onError?: (err: Error) => void
}

export interface UseAIStreamReturn {
  /** 是否正在流式输出 */
  streaming: ReturnType<typeof ref<boolean>>
  /** 最近一次错误（已重试 token 刷新） */
  error: ReturnType<typeof ref<Error | null>>
  /** 发起流式请求 */
  send: (question: string, sessionId?: string) => Promise<void>
  /** 主动中断 */
  abort: () => void
}

export function useAIStream(options: UseAIStreamOptions = {}): UseAIStreamReturn {
  const authStore = useAuthStore()
  const streaming = ref(false)
  const error = ref<Error | null>(null)
  let abortController: AbortController | null = null

  /** 复用一次完整请求：内部完成 token-refresh-retry */
  async function runStreamWithRetry(
    question: string,
    sessionId: string,
    token: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      consumeSSEWithHistory(
        question,
        sessionId,
        token,
        {
          onChunk: (text) => options.onChunk?.(text),
          onDone: () => {
            options.onDone?.()
            resolve()
          },
          onError: async (err) => {
            // 自动 token 刷新 + 重试
            const retried = await tryRefreshTokenAndRetry(question, sessionId)
            if (retried) {
              resolve()
              return
            }
            options.onError?.(err)
            reject(err)
          },
        },
        abortController?.signal,
      )
    })
  }

  /** 尝试通过刷新 token 后重试一次 */
  async function tryRefreshTokenAndRetry(
    question: string,
    sessionId: string,
  ): Promise<boolean> {
    // 重新从 store 取当前 token（已被 main.ts 的回调更新过）
    const newToken = authStore.token || ''
    if (!newToken) return false

    try {
      await runStreamWithRetry(question, sessionId, newToken)
      return true
    } catch {
      return false
    }
  }

  async function send(question: string, sessionId?: string): Promise<void> {
    error.value = null
    streaming.value = true
    abortController = new AbortController()
    const sid = sessionId || ''

    try {
      const token = authStore.token || ''
      if (!token) {
        throw new Error('未登录或登录已过期')
      }
      await runStreamWithRetry(question, sid, token)
    } catch (err) {
      error.value = err as Error
    } finally {
      streaming.value = false
      abortController = null
    }
  }

  function abort(): void {
    abortController?.abort()
    abortController = null
    streaming.value = false
  }

  // 组件卸载时自动 abort，避免泄漏
  onUnmounted(abort)

  return { streaming, error, send, abort }
}

/** 判断错误是否为 token 过期 */
export function isTokenExpiredError(message: string): boolean {
  return TOKEN_EXPIRED_HINTS.some((hint) =>
    message.toLowerCase().includes(hint.toLowerCase()),
  )
}
