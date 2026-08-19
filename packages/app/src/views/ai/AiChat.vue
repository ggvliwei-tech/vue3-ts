<script setup lang="ts">
import { ref, nextTick, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { chatWithHistory, createSession } from '@/api/ai'
import { consumeSSEWithHistory } from '@/utils/sse'
import { refreshToken } from '@/api/user'
import { showToast } from 'vant'
import MarkdownIt from 'markdown-it'

const router = useRouter()

// 未授权错误关键词
const TOKEN_EXPIRED_MSG = 'Token已过期或无效，请重新登录'

/**
 * 检查是否为 token 过期错误，若是则自动刷新 token
 * @returns true 表示是 token 过期且刷新成功
 */
async function autoRefreshToken(msg: string): Promise<boolean> {
  if (!msg.includes(TOKEN_EXPIRED_MSG)) return false

  try {
    const res = await refreshToken()
    const newToken = res.data.data.accessToken
    localStorage.setItem('token', newToken)
    return true
  } catch {
    // 刷新失败，跳转登录页
    localStorage.removeItem('token')
    router.push('/login')
    return false
  }
}

// markdown-it 实例
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
})

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

const messages = ref<Message[]>([])
const inputText = ref('')
const loading = ref(false)
const sessionId = ref('')
const isStreaming = ref(false)

const chatContainerRef = ref<HTMLDivElement | null>(null)
let abortController: AbortController | null = null

// 滚动到底部
async function scrollToBottom() {
  await nextTick()
  if (chatContainerRef.value) {
    chatContainerRef.value.scrollTop = chatContainerRef.value.scrollHeight
  }
}

// 获取或创建 sessionId
async function ensureSessionId() {
  if (sessionId.value) return
  try {
    const res = await createSession()
    // 兼容不同响应结构
    const newId = (res.data as any)?.data?.sessionId
              || (res.data as any)?.sessionId
              || (res as any)?.data?.sessionId
    if (newId) {
      sessionId.value = newId
      return
    }
  } catch (e) {
    console.warn('[AI] createSession 失败，使用 fallback:', e)
  }
  // fallback: 前端生成
  sessionId.value = crypto.randomUUID?.() ?? `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// 解析 SSE 返回的 data 字段 — 后端现在发纯文本，兼容旧格式
function parseSSEData(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
    if (typeof parsed?.data === 'string') return parsed.data
    if (typeof parsed?.content === 'string') return parsed.content
    return ''
  } catch {
    // 纯文本直接返回
    return raw
  }
}

// 渲染 markdown 内容
function renderMarkdown(content: string): string {
  if (!content) return ''
  return md.render(content)
}

// 发送消息（非流式，带历史）
async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || loading.value || isStreaming.value) return

  inputText.value = ''

  // 添加用户消息
  messages.value.push({
    role: 'user',
    content: text,
    timestamp: Date.now(),
  })
  await scrollToBottom()

  loading.value = true

  try {
    await ensureSessionId()

    const res = await chatWithHistory({
      question: text,
      sessionId: sessionId.value,
    })

    const content = typeof res.data.data === 'string'
      ? res.data.data
      : (res.data.data as any)?.content || ''

    messages.value.push({
      role: 'assistant',
      content,
      timestamp: Date.now(),
    })
  } catch (err: any) {
    // 检查是否为 token 过期，是则自动刷新并重试
    if (await autoRefreshToken(err.message)) {
      try {
        const res = await chatWithHistory({
          question: text,
          sessionId: sessionId.value,
        })

        const content = typeof res.data.data === 'string'
          ? res.data.data
          : (res.data.data as any)?.content || ''

        messages.value.push({
          role: 'assistant',
          content,
          timestamp: Date.now(),
        })
        return
      } catch (retryErr: any) {
        messages.value.push({
          role: 'assistant',
          content: `出错了：${retryErr.message || '请求失败'}`,
          timestamp: Date.now(),
        })
        return
      }
    }

    messages.value.push({
      role: 'assistant',
      content: `出错了：${err.message || '请求失败'}`,
      timestamp: Date.now(),
    })
  } finally {
    loading.value = false
    await scrollToBottom()
  }
}

// 流式发送消息（打字机效果）
async function sendStreamMessage() {
  const text = inputText.value.trim()
  if (!text || loading.value || isStreaming.value) return

  inputText.value = ''
  isStreaming.value = true

  // 添加用户消息
  messages.value.push({
    role: 'user',
    content: text,
    timestamp: Date.now(),
  })
  await scrollToBottom()

  // 添加一个空的 AI 消息占位
  const aiMessageIndex = messages.value.length
  messages.value.push({
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
  })
  await scrollToBottom()

  const token = localStorage.getItem('token') || ''
  abortController = new AbortController()

  try {
    await ensureSessionId()

    await consumeSSEWithHistory(text, sessionId.value, token, {
      onChunk: async (chunk) => {
        const parsed = parseSSEData(chunk)
        // 检测 SSE 数据块中是否包含 token 过期消息
        if (parsed.includes(TOKEN_EXPIRED_MSG)) {
          // 清除已追加的 token 过期内容
          messages.value[aiMessageIndex].content = ''
          // 终止当前流
          abortController?.abort()
          // 自动刷新 token
          if (await autoRefreshToken(TOKEN_EXPIRED_MSG)) {
            const newToken = localStorage.getItem('token') || ''
            if (newToken) {
              // 使用新 token 重新发起请求
              try {
                await consumeSSEWithHistory(text, sessionId.value, newToken, {
                  onChunk: (c) => {
                    const t = parseSSEData(c)
                    messages.value[aiMessageIndex].content += t
                    scrollToBottom()
                  },
                  onDone: () => {
                    isStreaming.value = false
                    abortController = null
                  },
                  onError: (err) => {
                    if (!messages.value[aiMessageIndex].content) {
                      messages.value[aiMessageIndex].content = `流式输出错误：${err.message}`
                    }
                    isStreaming.value = false
                    abortController = null
                    showToast(err.message || '流式输出失败')
                  },
                }, abortController!.signal)
                return
              } catch {
                // 重试失败，走兜底逻辑
              }
            }
          }
          // 刷新也失败
          messages.value[aiMessageIndex].content = 'Token 刷新失败，请重新登录'
          isStreaming.value = false
          abortController = null
          showToast('Token 刷新失败')
          return
        }
        // 正常内容追加
        messages.value[aiMessageIndex].content += parsed
        scrollToBottom()
      },
      onDone: () => {
        isStreaming.value = false
        abortController = null
      },
      onError: async (error) => {
        // 检查是否为 token 过期，是则自动刷新并重试
        if (await autoRefreshToken(error.message)) {
          const newToken = localStorage.getItem('token') || ''
          if (newToken) {
            try {
              await consumeSSEWithHistory(text, sessionId.value, newToken, {
                onChunk: (chunk) => {
                  const text = parseSSEData(chunk)
                  messages.value[aiMessageIndex].content += text
                  scrollToBottom()
                },
                onDone: () => {
                  isStreaming.value = false
                  abortController = null
                },
                onError: (err) => {
                  if (!messages.value[aiMessageIndex].content) {
                    messages.value[aiMessageIndex].content = `流式输出错误：${err.message}`
                  }
                  isStreaming.value = false
                  abortController = null
                  showToast(err.message || '流式输出失败')
                },
              }, abortController!.signal)
              return
            } catch {
              // 重试也失败，走下面兜底逻辑
            }
          }
        }

        if (!messages.value[aiMessageIndex].content) {
          messages.value[aiMessageIndex].content = `流式输出错误：${error.message}`
        }
        isStreaming.value = false
        abortController = null
        showToast(error.message || '流式输出失败')
      },
    }, abortController.signal)
  } catch (err: any) {
    // 检测是否为 token 过期
    if (await autoRefreshToken(err.message)) {
      const newToken = localStorage.getItem('token') || ''
      if (newToken) {
        try {
          await consumeSSEWithHistory(text, sessionId.value, newToken, {
            onChunk: (chunk) => {
              const parsed = parseSSEData(chunk)
              messages.value[aiMessageIndex].content += parsed
              scrollToBottom()
            },
            onDone: () => {
              isStreaming.value = false
              abortController = null
            },
            onError: (error) => {
              if (!messages.value[aiMessageIndex].content) {
                messages.value[aiMessageIndex].content = `流式输出错误：${error.message}`
              }
              isStreaming.value = false
              abortController = null
              showToast(error.message || '流式输出失败')
            },
          }, abortController!.signal)
          return
        } catch {
          // 重试失败，走兜底
        }
      }
    }

    if (!messages.value[aiMessageIndex].content) {
      messages.value[aiMessageIndex].content = `请求失败：${err.message}`
    }
    isStreaming.value = false
    abortController = null
  }
}

// 停止流式输出
function stopStreaming() {
  abortController?.abort()
  isStreaming.value = false
}

// 清空对话
function clearChat() {
  messages.value = []
  sessionId.value = ''
  showToast('已清空对话')
}

// 组件卸载时清理
onUnmounted(() => {
  abortController?.abort()
})
</script>

<template>
  <div class="ai-chat-page">
    <!-- 顶部导航栏 -->
    <van-nav-bar
      title="AI 智能助手"
      left-arrow
      @click-left="router.back()"
    >
      <template #right>
        <van-icon name="delete-o" size="20" @click="clearChat" />
      </template>
    </van-nav-bar>

    <!-- 消息列表区域 -->
    <div ref="chatContainerRef" class="chat-container">
      <div v-if="messages.length === 0" class="empty-hint">
        <van-icon name="chat-o" size="64" color="#dcdee0" />
        <p>开始与 AI 对话吧</p>
      </div>

      <div
        v-for="(msg, index) in messages"
        :key="index"
        class="message-row"
        :class="msg.role === 'user' ? 'message-user' : 'message-ai'"
      >
        <van-image
          v-if="msg.role === 'assistant'"
          round
          width="32"
          height="32"
          src="https://sybimg.banglail.com/app-icons/2025-07-23/57d57ca4bf9c4f0fb63edc76c3a1cfe9.png"
          class="message-avatar"
        />
        <div class="message-bubble">
          <div
            v-if="msg.role === 'assistant'"
            class="message-content markdown-body"
            v-html="renderMarkdown(msg.content)"
          ></div>
          <div v-else class="message-content">{{ msg.content }}</div>
          <div class="message-time">
            {{ new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}
          </div>
        </div>
        <van-image
          v-if="msg.role === 'user'"
          round
          width="32"
          height="32"
          src="https://sybimg.banglail.com/app-icons/2025-07-23/57d57ca4bf9c4f0fb63edc76c3a1cfe9.png"
          class="message-avatar"
        />
      </div>

      <!-- 加载中指示器 -->
      <div v-if="loading && !isStreaming" class="message-row message-ai">
        <van-loading type="spinner" size="20" vertical>思考中...</van-loading>
      </div>
    </div>

    <!-- 底部输入区域 -->
    <div class="input-area">
      <van-field
        v-model="inputText"
        type="textarea"
        placeholder="输入你的问题..."
        :autosize="{ maxHeight: 120, minHeight: 40 }"
        :disabled="isStreaming"
        @keydown.enter.exact.prevent="sendStreamMessage"
      />
      <div class="input-actions">
        <van-button
          v-if="isStreaming"
          type="danger"
          size="small"
          round
          @click="stopStreaming"
        >
          停止
        </van-button>
        <van-button
          v-else
          type="primary"
          size="small"
          round
          :loading="loading"
          :disabled="!inputText.trim()"
          @click="sendStreamMessage"
        >
          发送
        </van-button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.ai-chat-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f5f5;
  overflow: hidden;

  .van-nav-bar {
    flex-shrink: 0;
  }
}

.chat-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  -webkit-overflow-scrolling: touch;
}

.empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #969799;
  gap: 12px;

  p {
    font-size: 14px;
    margin: 0;
  }
}

.message-row {
  display: flex;
  align-items: flex-start;
  margin-bottom: 16px;
  gap: 8px;
}

.message-user {
  flex-direction: row-reverse;

  .message-bubble {
    background: #1989fa;
    color: #fff;
    border-radius: 12px 2px 12px 12px;
  }
}

.message-ai {
  .message-bubble {
    background: #fff;
    color: #323233;
    border-radius: 2px 12px 12px 12px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  }
}

.message-avatar {
  flex-shrink: 0;
}

.message-bubble {
  max-width: 70%;
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

.message-content {
  white-space: pre-wrap;
}

// Markdown 渲染样式
:deep(.markdown-body) {
  white-space: normal;

  // 段落和文本
  p {
    margin: 0 0 8px;
    line-height: 1.6;

    &:last-child {
      margin-bottom: 0;
    }
  }

  // 行内代码
  code {
    background: rgba(0, 0, 0, 0.06);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 13px;
    color: #e83e8c;
    word-break: break-word;
  }

  // 代码块
  pre {
    background: #282c34;
    color: #abb2bf;
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 8px 0;
    font-size: 13px;
    line-height: 1.5;

    code {
      background: none;
      padding: 0;
      color: inherit;
      font-size: inherit;
    }
  }

  // 标题
  h1, h2, h3, h4, h5, h6 {
    margin: 12px 0 6px;
    font-weight: 600;
    line-height: 1.4;
    color: inherit;

    &:first-child {
      margin-top: 0;
    }
  }

  h1 { font-size: 18px; }
  h2 { font-size: 16px; }
  h3 { font-size: 15px; }

  // 列表
  ul, ol {
    padding-left: 20px;
    margin: 4px 0;
  }

  li {
    margin: 2px 0;
    line-height: 1.6;
  }

  // 链接
  a {
    color: #1989fa;
    text-decoration: none;
    word-break: break-all;
  }

  // 引用
  blockquote {
    border-left: 3px solid #dcdee0;
    padding-left: 12px;
    color: #969799;
    margin: 8px 0;
  }

  // 表格
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 8px 0;
    font-size: 13px;

    th, td {
      border: 1px solid #ebedf0;
      padding: 6px 10px;
      text-align: left;
    }

    th {
      background: #f5f5f5;
      font-weight: 600;
    }
  }

  // 水平线
  hr {
    border: none;
    border-top: 1px solid #ebedf0;
    margin: 12px 0;
  }

  // 加粗和斜体
  strong {
    font-weight: 600;
  }

  em {
    font-style: italic;
  }
}

.message-time {
  font-size: 10px;
  opacity: 0.6;
  margin-top: 4px;
  text-align: right;
}

.input-area {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 12px;
  padding-bottom: max(8px, env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid #ebedf0;

  :deep(.van-field) {
    flex: 1;
    padding: 0;
    background: transparent;
  }

  :deep(.van-field__control) {
    font-size: 14px;
  }
}

.input-actions {
  flex-shrink: 0;
}
</style>
