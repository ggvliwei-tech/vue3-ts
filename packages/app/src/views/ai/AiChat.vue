<!-- script setup 块：使用 Composition API 语法糖定义 AI 聊天页面逻辑 -->
<script setup lang="ts">
// 从 vue 中导入 ref（响应式引用）、nextTick（DOM 更新后回调）、onMounted 和 onUnmounted（生命周期钩子）
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
// 从 vue-router 中导入 useRouter 函数用于路由导航
import { useRouter } from 'vue-router'
// 从 AI API 模块中导入聊天和会话相关函数
import { chatWithHistory, createSession, getLastSession } from '@/api/ai'
// 从 SSE 工具模块中导入带历史上下文的流式消费函数
import { consumeSSEWithHistory } from '@/utils/sse'
// 从用户 API 模块中导入刷新 token 函数
import { refreshToken } from '@/api/user'
// 从 vant 中导入 showToast 轻提示组件方法
import { showToast } from 'vant'
// 导入 MarkdownIt 库用于将 Markdown 渲染为 HTML
import MarkdownIt from 'markdown-it'

// 获取路由导航实例
const router = useRouter()

// 未授权错误关键词常量，用于检测 token 过期错误
const TOKEN_EXPIRED_MSG = 'Token已过期或无效，请重新登录'

/**
 * 检查是否为 token 过期错误，若是则自动刷新 token
 * @param msg - 错误消息字符串
 * @returns true 表示是 token 过期且刷新成功
 */
async function autoRefreshToken(msg: string): Promise<boolean> {
  // 如果错误消息中不包含 token 过期关键词，则直接返回 false
  if (!msg.includes(TOKEN_EXPIRED_MSG)) return false

  // 使用 try-catch 捕获刷新 token 请求可能抛出的异常
  try {
    // 调用 refreshToken 接口获取新的 token
    const res = await refreshToken()
    // 从响应中提取新的 accessToken
    const newToken = res.data.data.accessToken
    // 将新 token 存储到 localStorage 中
    localStorage.setItem('token', newToken)
    // 刷新成功返回 true
    return true
  } catch {
    // 刷新失败时，清除本地存储的 token
    localStorage.removeItem('token')
    // 跳转到登录页让用户重新登录
    router.push('/login')
    // 刷新失败返回 false
    return false
  }
}

// 创建 markdown-it 实例，配置渲染选项
const md = new MarkdownIt({
  // 不允许 HTML 标签直接输出
  html: false,
  // 自动将 URL 转换为链接
  linkify: true,
  // 启用排版替换（如 "..." 转换为 ellipsis）
  typographer: true,
  // 启用换行符转换为 <br>
  breaks: true,
})

// 定义消息类型接口
interface Message {
  // 消息角色，用户或 AI 助手
  role: 'user' | 'assistant'
  // 消息内容文本
  content: string
  // 消息发送时间戳
  timestamp: number
}

// 定义消息列表的响应式数组
const messages = ref<Message[]>([])
// 定义输入框文本的响应式数据
const inputText = ref('')
// 定义非流式请求加载状态的响应式数据
const loading = ref(false)
// 定义当前会话 ID 的响应式数据
const sessionId = ref('')
// 定义是否正在流式输出的响应式数据
const isStreaming = ref(false)
// 定义是否显示恢复上次会话提示的响应式数据
const showResumeHint = ref(false)

// 定义聊天容器的 DOM 引用
const chatContainerRef = ref<HTMLDivElement | null>(null)
// 定义 AbortController 用于中断正在进行的 SSE 请求
let abortController: AbortController | null = null

// 组件挂载时恢复上次会话
onMounted(async () => {
  // 先从 localStorage 中快速获取缓存的会话 ID
  const cachedSessionId = localStorage.getItem('ai:last_session_id')
  // 如果存在缓存的会话 ID
  if (cachedSessionId) {
    // 将缓存的会话 ID 赋值给响应式变量
    sessionId.value = cachedSessionId
    // 显示恢复会话提示
    showResumeHint.value = true
  }
  // 再从服务端验证或更新会话信息
  try {
    // 调用获取最近会话 API
    const res = await getLastSession()
    // 从响应中提取服务端返回的会话 ID（兼容不同响应结构）
    const serverSessionId = (res.data as any)?.data?.sessionId
    // 如果服务端有会话 ID 且与当前不同
    if (serverSessionId && serverSessionId !== sessionId.value) {
      // 更新当前会话 ID
      sessionId.value = serverSessionId
      // 将新会话 ID 缓存到 localStorage 中
      localStorage.setItem('ai:last_session_id', serverSessionId)
      // 显示恢复会话提示
      showResumeHint.value = true
    }
  } catch (e) {
    // 获取最近会话失败时打印警告日志
    console.warn('[AI] 获取最近会话失败:', e)
  }
})

// 滚动聊天容器到底部的异步函数
async function scrollToBottom() {
  // 等待 DOM 更新完成
  await nextTick()
  // 如果聊天容器引用存在
  if (chatContainerRef.value) {
    // 将容器的滚动位置设置为最大滚动高度（即滚动到底部）
    chatContainerRef.value.scrollTop = chatContainerRef.value.scrollHeight
  }
}

// 获取或创建 sessionId 的异步函数
async function ensureSessionId() {
  // 如果已经存在 sessionId 则直接返回
  if (sessionId.value) return
  // 使用 try-catch 捕获创建会话请求可能抛出的异常
  try {
    // 调用创建会话 API
    const res = await createSession()
    // 兼容不同的响应结构，尝试多种方式提取 sessionId
    const newId = (res.data as any)?.data?.sessionId
              || (res.data as any)?.sessionId
              || (res as any)?.data?.sessionId
    // 如果成功提取到 sessionId
    if (newId) {
      // 赋值给响应式变量
      sessionId.value = newId
      // 缓存到 localStorage 中
      localStorage.setItem('ai:last_session_id', newId)
      return
    }
  } catch (e) {
    // 创建会话失败时打印警告日志
    console.warn('[AI] createSession 失败，使用 fallback:', e)
  }
  // 兜底方案：前端生成一个唯一 ID
  sessionId.value = crypto.randomUUID?.() ?? `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  // 将生成的 ID 缓存到 localStorage 中
  localStorage.setItem('ai:last_session_id', sessionId.value)
}

// 解析 SSE 返回的 data 字段的函数，处理不同格式的数据
function parseSSEData(raw: string): string {
  // 使用 try-catch 尝试将字符串解析为 JSON
  try {
    // 尝试解析 JSON 字符串
    const parsed = JSON.parse(raw)
    // 如果解析结果是字符串类型，直接返回
    if (typeof parsed === 'string') return parsed
    // 如果解析结果中有 data 字段且为字符串，返回该字段
    if (typeof parsed?.data === 'string') return parsed.data
    // 如果解析结果中有 content 字段且为字符串，返回该字段
    if (typeof parsed?.content === 'string') return parsed.content
    // 其他情况返回空字符串
    return ''
  } catch {
    // JSON 解析失败说明是纯文本，直接返回原始字符串
    return raw
  }
}

// 将 Markdown 内容渲染为 HTML 的函数
function renderMarkdown(content: string): string {
  // 如果内容为空则返回空字符串
  if (!content) return ''
  // 使用 markdown-it 实例将 Markdown 渲染为 HTML
  return md.render(content)
}

// 发送消息的异步函数（非流式，带历史上下文）
async function sendMessage() {
  // 获取输入框中的文本并去除首尾空格
  const text = inputText.value.trim()
  // 如果文本为空或正在加载中或正在流式输出，则直接返回
  if (!text || loading.value || isStreaming.value) return

  // 清空输入框内容
  inputText.value = ''

  // 将用户消息添加到消息列表中
  messages.value.push({
    role: 'user',
    content: text,
    timestamp: Date.now(),
  })
  // 滚动到底部显示新消息
  await scrollToBottom()

  // 设置加载状态为 true
  loading.value = true

  // 使用 try-catch 捕获请求可能抛出的异常
  try {
    // 确保存在有效的 sessionId
    await ensureSessionId()

    // 调用带历史上下文的聊天 API
    const res = await chatWithHistory({
      question: text,
      sessionId: sessionId.value,
    })

    // 兼容不同的响应结构，提取 AI 回答内容
    const content = typeof res.data.data === 'string'
      ? res.data.data
      : (res.data.data as any)?.content || ''

    // 将 AI 回答添加到消息列表中
    messages.value.push({
      role: 'assistant',
      content,
      timestamp: Date.now(),
    })
  } catch (err: any) {
    // 检查是否为 token 过期，若是则自动刷新并重试
    if (await autoRefreshToken(err.message)) {
      try {
        // 刷新成功后重新发起聊天请求
        const res = await chatWithHistory({
          question: text,
          sessionId: sessionId.value,
        })

        // 提取 AI 回答内容
        const content = typeof res.data.data === 'string'
          ? res.data.data
          : (res.data.data as any)?.content || ''

        // 将 AI 回答添加到消息列表中
        messages.value.push({
          role: 'assistant',
          content,
          timestamp: Date.now(),
        })
        return
      } catch (retryErr: any) {
        // 重试失败时显示错误消息
        messages.value.push({
          role: 'assistant',
          content: `出错了：${retryErr.message || '请求失败'}`,
          timestamp: Date.now(),
        })
        return
      }
    }

    // token 未过期或其他错误时显示错误消息
    messages.value.push({
      role: 'assistant',
      content: `出错了：${err.message || '请求失败'}`,
      timestamp: Date.now(),
    })
  } finally {
    // 无论成功还是失败，都将加载状态重置为 false
    loading.value = false
    // 滚动到底部
    await scrollToBottom()
  }
}

// 流式发送消息的异步函数（打字机效果）
async function sendStreamMessage() {
  // 获取输入框中的文本并去除首尾空格
  const text = inputText.value.trim()
  // 如果文本为空或正在加载中或正在流式输出，则直接返回
  if (!text || loading.value || isStreaming.value) return

  // 清空输入框内容
  inputText.value = ''
  // 设置流式输出状态为 true
  isStreaming.value = true

  // 将用户消息添加到消息列表中
  messages.value.push({
    role: 'user',
    content: text,
    timestamp: Date.now(),
  })
  // 滚动到底部显示新消息
  await scrollToBottom()

  // 记录即将创建的 AI 消息在列表中的索引位置
  const aiMessageIndex = messages.value.length
  // 添加一个空的 AI 消息占位符用于后续逐字填充
  messages.value.push({
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
  })
  // 滚动到底部
  await scrollToBottom()

  // 从 localStorage 中获取当前 token
  const token = localStorage.getItem('token') || ''
  // 创建 AbortController 用于中断流式请求
  abortController = new AbortController()

  // 使用 try-catch 捕获流式请求可能抛出的异常
  try {
    // 确保存在有效的 sessionId
    await ensureSessionId()

    // 调用 SSE 流式消费函数
    await consumeSSEWithHistory(text, sessionId.value, token, {
      // 接收到数据块时的回调函数
      onChunk: async (chunk) => {
        // 解析 SSE 数据块
        const parsed = parseSSEData(chunk)
        // 检测 SSE 数据块中是否包含 token 过期消息
        if (parsed.includes(TOKEN_EXPIRED_MSG)) {
          // 清除已追加的 token 过期内容
          messages.value[aiMessageIndex].content = ''
          // 终止当前流式请求
          abortController?.abort()
          // 自动刷新 token
          if (await autoRefreshToken(TOKEN_EXPIRED_MSG)) {
            // 获取刷新后的新 token
            const newToken = localStorage.getItem('token') || ''
            // 如果新 token 存在
            if (newToken) {
              // 使用新 token 重新发起 SSE 流式请求
              try {
                await consumeSSEWithHistory(text, sessionId.value, newToken, {
                  // 正常接收数据块时追加到 AI 消息中
                  onChunk: (c) => {
                    const t = parseSSEData(c)
                    messages.value[aiMessageIndex].content += t
                    scrollToBottom()
                  },
                  // 流式完成时的回调
                  onDone: () => {
                    isStreaming.value = false
                    abortController = null
                  },
                  // 流式出错时的回调
                  onError: (err) => {
                    // 如果消息内容为空则显示错误提示
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
                // 重试失败时走兜底逻辑
              }
            }
          }
          // token 刷新也失败时显示提示
          messages.value[aiMessageIndex].content = 'Token 刷新失败，请重新登录'
          isStreaming.value = false
          abortController = null
          showToast('Token 刷新失败')
          return
        }
        // 正常内容：将解析后的数据追加到 AI 消息中
        messages.value[aiMessageIndex].content += parsed
        scrollToBottom()
      },
      // 流式完成时的回调函数
      onDone: () => {
        // 重置流式输出状态
        isStreaming.value = false
        // 清空 AbortController 引用
        abortController = null
      },
      // 流式出错时的回调函数
      onError: async (error) => {
        // 检查是否为 token 过期，是则自动刷新并重试
        if (await autoRefreshToken(error.message)) {
          // 获取刷新后的新 token
          const newToken = localStorage.getItem('token') || ''
          // 如果新 token 存在
          if (newToken) {
            try {
              // 使用新 token 重新发起 SSE 流式请求
              await consumeSSEWithHistory(text, sessionId.value, newToken, {
                // 正常接收数据块时追加到 AI 消息中
                onChunk: (chunk) => {
                  const text = parseSSEData(chunk)
                  messages.value[aiMessageIndex].content += text
                  scrollToBottom()
                },
                // 流式完成时的回调
                onDone: () => {
                  isStreaming.value = false
                  abortController = null
                },
                // 流式出错时的回调
                onError: (err) => {
                  // 如果消息内容为空则显示错误提示
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
              // 重试也失败时走下面的兜底逻辑
            }
          }
        }

        // 如果消息内容为空则显示错误提示
        if (!messages.value[aiMessageIndex].content) {
          messages.value[aiMessageIndex].content = `流式输出错误：${error.message}`
        }
        // 重置流式输出状态
        isStreaming.value = false
        // 清空 AbortController 引用
        abortController = null
        // 显示错误提示
        showToast(error.message || '流式输出失败')
      },
    }, abortController.signal)
  } catch (err: any) {
    // 检测是否为 token 过期
    if (await autoRefreshToken(err.message)) {
      // 获取刷新后的新 token
      const newToken = localStorage.getItem('token') || ''
      // 如果新 token 存在
      if (newToken) {
        try {
          // 使用新 token 重新发起 SSE 流式请求
          await consumeSSEWithHistory(text, sessionId.value, newToken, {
            // 正常接收数据块时追加到 AI 消息中
            onChunk: (chunk) => {
              const parsed = parseSSEData(chunk)
              messages.value[aiMessageIndex].content += parsed
              scrollToBottom()
            },
            // 流式完成时的回调
            onDone: () => {
              isStreaming.value = false
              abortController = null
            },
            // 流式出错时的回调
            onError: (error) => {
              // 如果消息内容为空则显示错误提示
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
          // 重试失败时走兜底逻辑
        }
      }
    }

    // 如果消息内容为空则显示错误提示
    if (!messages.value[aiMessageIndex].content) {
      messages.value[aiMessageIndex].content = `请求失败：${err.message}`
    }
    // 重置流式输出状态
    isStreaming.value = false
    // 清空 AbortController 引用
    abortController = null
  }
}

// 停止流式输出的函数
function stopStreaming() {
  // 调用 AbortController 的 abort 方法中断当前流式请求
  abortController?.abort()
  // 重置流式输出状态
  isStreaming.value = false
}

// 清空对话的函数
function clearChat() {
  // 清空消息列表数组
  messages.value = []
  // 重置会话 ID
  sessionId.value = ''
  // 隐藏恢复会话提示
  showResumeHint.value = false
  // 从 localStorage 中清除缓存的会话 ID
  localStorage.removeItem('ai:last_session_id')
  // 显示清空对话提示
  showToast('已清空对话')
}

// 组件卸载时执行的清理函数
onUnmounted(() => {
  // 中断可能正在进行的流式请求
  abortController?.abort()
})
</script>

<!-- template 模板块：定义 AI 聊天页面的 HTML 结构 -->
<template>
  <!-- AI 聊天页面外层容器 -->
  <div class="ai-chat-page">
    <!-- 顶部导航栏 -->
    <van-nav-bar
      title="AI 智能助手"
      left-arrow
      @click-left="router.back()"
    >
      <!-- 右侧插槽：放置清空对话图标按钮 -->
      <template #right>
        <van-icon name="delete-o" size="20" @click="clearChat" />
      </template>
    </van-nav-bar>

    <!-- 消息列表区域，使用 ref 绑定 DOM 引用用于滚动 -->
    <div ref="chatContainerRef" class="chat-container">
      <!-- 当消息列表为空时显示的空状态提示 -->
      <div v-if="messages.length === 0" class="empty-hint">
        <!-- 如果显示恢复上次会话提示 -->
        <template v-if="showResumeHint">
          <!-- 聊天图标 -->
          <van-icon name="chat-o" size="64" color="#dcdee0" />
          <!-- 恢复提示文字 -->
          <p>已恢复上次对话，继续提问吧</p>
          <!-- 开启新对话按钮 -->
          <van-button type="primary" size="small" round class="new-chat-btn" @click="clearChat">
            开启新对话
          </van-button>
        </template>
        <!-- 如果不显示恢复提示，显示默认空状态 -->
        <template v-else>
          <!-- 聊天图标 -->
          <van-icon name="chat-o" size="64" color="#dcdee0" />
          <!-- 默认提示文字 -->
          <p>开始与 AI 对话吧</p>
        </template>
      </div>

      <!-- 遍历消息列表，渲染每条消息 -->
      <div
        v-for="(msg, index) in messages"
        :key="index"
        class="message-row"
        :class="msg.role === 'user' ? 'message-user' : 'message-ai'"
      >
        <!-- AI 消息时显示 AI 头像（左侧） -->
        <van-image
          v-if="msg.role === 'assistant'"
          round
          width="32"
          height="32"
          src="https://sybimg.banglail.com/app-icons/2025-07-23/57d57ca4bf9c4f0fb63edc76c3a1cfe9.png"
          class="message-avatar"
        />
        <!-- 消息气泡容器 -->
        <div class="message-bubble">
          <!-- AI 消息内容：使用 v-html 渲染 Markdown 为 HTML -->
          <div
            v-if="msg.role === 'assistant'"
            class="message-content markdown-body"
            v-html="renderMarkdown(msg.content)"
          ></div>
          <!-- 用户消息内容：纯文本显示 -->
          <div v-else class="message-content">{{ msg.content }}</div>
          <!-- 消息发送时间，格式化为小时:分钟 -->
          <div class="message-time">
            {{ new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}
          </div>
        </div>
        <!-- 用户消息时显示用户头像（右侧） -->
        <van-image
          v-if="msg.role === 'user'"
          round
          width="32"
          height="32"
          src="https://sybimg.banglail.com/app-icons/2025-07-23/57d57ca4bf9c4f0fb63edc76c3a1cfe9.png"
          class="message-avatar"
        />
      </div>

      <!-- 加载中指示器：非流式请求加载时显示 -->
      <div v-if="loading && !isStreaming" class="message-row message-ai">
        <van-loading type="spinner" size="20" vertical>思考中...</van-loading>
      </div>
    </div>

    <!-- 底部输入区域 -->
    <div class="input-area">
      <!-- Vant 文本输入框，支持自动高度调整 -->
      <van-field
        v-model="inputText"
        type="textarea"
        placeholder="输入你的问题..."
        :autosize="{ maxHeight: 120, minHeight: 40 }"
        :disabled="isStreaming"
        @keydown.enter.exact.prevent="sendStreamMessage"
      />
      <!-- 输入框右侧操作按钮区域 -->
      <div class="input-actions">
        <!-- 流式输出时显示停止按钮 -->
        <van-button
          v-if="isStreaming"
          type="danger"
          size="small"
          round
          @click="stopStreaming"
        >
          停止
        </van-button>
        <!-- 非流式时显示发送按钮 -->
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

<!-- style 样式块：定义 AI 聊天页面的局部样式 -->
<style lang="scss" scoped>
// AI 聊天页面容器样式
.ai-chat-page {
  // 使用 flex 布局
  display: flex;
  // flex 子项垂直排列
  flex-direction: column;
  // 高度占满整个视口
  height: 100vh;
  // 背景色为浅灰色
  background: #f5f5f5;
  // 隐藏溢出内容
  overflow: hidden;

  // Vant 导航栏样式
  .van-nav-bar {
    // 不允许收缩，保持固定高度
    flex-shrink: 0;
  }
}

// 聊天消息容器样式
.chat-container {
  // flex 子项占满剩余空间
  flex: 1;
  // 垂直方向可滚动
  overflow-y: auto;
  // 四周内边距 16px
  padding: 16px;
  // 启用 iOS 原生滚动回弹效果
  -webkit-overflow-scrolling: touch;
}

// 空状态提示样式
.empty-hint {
  // 使用 flex 布局
  display: flex;
  // 垂直排列
  flex-direction: column;
  // 水平居中
  align-items: center;
  // 垂直居中
  justify-content: center;
  // 高度占满父容器
  height: 100%;
  // 字体颜色浅灰
  color: #969799;
  // 子元素间距 12px
  gap: 12px;

  // 新对话按钮样式
  .new-chat-btn {
    // 顶部外边距 8px
    margin-top: 8px;
  }

  // 提示段落样式
  p {
    // 字体大小 14px
    font-size: 14px;
    // 无外边距
    margin: 0;
  }
}

// 消息行通用样式
.message-row {
  // 使用 flex 布局
  display: flex;
  // 子项顶部对齐
  align-items: flex-start;
  // 底部外边距 16px
  margin-bottom: 16px;
  // 子元素间距 8px
  gap: 8px;
}

// 用户消息行样式
.message-user {
  // 反转 flex 排列方向（头像在右侧）
  flex-direction: row-reverse;

  // 用户消息气泡样式
  .message-bubble {
    // 背景色为主题蓝色
    background: #1989fa;
    // 文字颜色为白色
    color: #fff;
    // 圆角样式（左上角直角）
    border-radius: 12px 2px 12px 12px;
  }
}

// AI 消息行样式
.message-ai {
  // AI 消息气泡样式
  .message-bubble {
    // 背景色为白色
    background: #fff;
    // 文字颜色为深灰
    color: #323233;
    // 圆角样式（右上角直角）
    border-radius: 2px 12px 12px 12px;
    // 添加轻微阴影
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  }
}

// 消息头像样式
.message-avatar {
  // 不允许收缩，保持固定大小
  flex-shrink: 0;
}

// 消息气泡通用样式
.message-bubble {
  // 最大宽度为父容器的 70%
  max-width: 70%;
  // 内边距上下 10px 左右 14px
  padding: 10px 14px;
  // 字体大小 14px
  font-size: 14px;
  // 行高 1.6
  line-height: 1.6;
  // 单词换行时允许在任意位置断开
  word-break: break-word;
}

// 消息内容通用样式
.message-content {
  // 保留空白和换行符
  white-space: pre-wrap;
}

// Markdown 渲染样式（使用 :deep 穿透 scoped）
:deep(.markdown-body) {
  // 不使用 pre-wrap，允许正常换行
  white-space: normal;

  // 段落和文本样式
  p {
    // 底部外边距 8px，上下无外边距
    margin: 0 0 8px;
    // 行高 1.6
    line-height: 1.6;

    // 最后一个段落无底部外边距
    &:last-child {
      margin-bottom: 0;
    }
  }

  // 行内代码样式
  code {
    // 半透明灰色背景
    background: rgba(0, 0, 0, 0.06);
    // 内边距上下 2px 左右 6px
    padding: 2px 6px;
    // 圆角 4px
    border-radius: 4px;
    // 等宽字体族
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    // 字体大小 13px
    font-size: 13px;
    // 字体颜色为粉红色
    color: #e83e8c;
    // 允许单词在任意位置断开换行
    word-break: break-word;
  }

  // 代码块样式
  pre {
    // 深色背景
    background: #282c34;
    // 文字颜色为浅色
    color: #abb2bf;
    // 内边距 12px
    padding: 12px;
    // 圆角 8px
    border-radius: 8px;
    // 水平方向可滚动
    overflow-x: auto;
    // 上下外边距 8px
    margin: 8px 0;
    // 字体大小 13px
    font-size: 13px;
    // 行高 1.5
    line-height: 1.5;

    // 代码块中的代码样式
    code {
      // 无背景
      background: none;
      // 无内边距
      padding: 0;
      // 文字颜色继承父元素
      color: inherit;
      // 字体大小继承父元素
      font-size: inherit;
    }
  }

  // 标题样式
  h1, h2, h3, h4, h5, h6 {
    // 上下外边距：顶部 12px 底部 6px
    margin: 12px 0 6px;
    // 字体粗细 600
    font-weight: 600;
    // 行高 1.4
    line-height: 1.4;
    // 文字颜色继承父元素
    color: inherit;

    // 第一个标题无顶部外边距
    &:first-child {
      margin-top: 0;
    }
  }

  // 一级标题字体大小
  h1 { font-size: 18px; }
  // 二级标题字体大小
  h2 { font-size: 16px; }
  // 三级标题字体大小
  h3 { font-size: 15px; }

  // 列表样式
  ul, ol {
    // 左侧内边距 20px
    padding-left: 20px;
    // 上下外边距 4px
    margin: 4px 0;
  }

  // 列表项样式
  li {
    // 上下外边距 2px
    margin: 2px 0;
    // 行高 1.6
    line-height: 1.6;
  }

  // 链接样式
  a {
    // 链接颜色为主题蓝色
    color: #1989fa;
    // 无下划线
    text-decoration: none;
    // 允许在任意位置断开换行
    word-break: break-all;
  }

  // 引用块样式
  blockquote {
    // 左侧 3px 宽的灰色边框
    border-left: 3px solid #dcdee0;
    // 左侧内边距 12px
    padding-left: 12px;
    // 字体颜色为浅灰
    color: #969799;
    // 上下外边距 8px
    margin: 8px 0;
  }

  // 表格样式
  table {
    // 边框合并
    border-collapse: collapse;
    // 宽度占满
    width: 100%;
    // 上下外边距 8px
    margin: 8px 0;
    // 字体大小 13px
    font-size: 13px;

    // 表头和单元格样式
    th, td {
      // 1px 宽的浅灰色边框
      border: 1px solid #ebedf0;
      // 上下 6px 左右 10px 的内边距
      padding: 6px 10px;
      // 文字左对齐
      text-align: left;
    }

    // 表头样式
    th {
      // 浅灰色背景
      background: #f5f5f5;
      // 字体粗细 600
      font-weight: 600;
    }
  }

  // 水平线样式
  hr {
    // 清除默认边框
    border: none;
    // 顶部 1px 宽的浅灰色线
    border-top: 1px solid #ebedf0;
    // 上下外边距 12px
    margin: 12px 0;
  }

  // 加粗样式
  strong {
    // 字体粗细 600
    font-weight: 600;
  }

  // 斜体样式
  em {
    // 设置斜体字体
    font-style: italic;
  }
}

// 消息时间样式
.message-time {
  // 字体大小 10px
  font-size: 10px;
  // 透明度 60%
  opacity: 0.6;
  // 顶部外边距 4px
  margin-top: 4px;
  // 文字右对齐
  text-align: right;
}

// 底部输入区域样式
.input-area {
  // 不允许收缩，保持固定高度
  flex-shrink: 0;
  // 使用 flex 布局
  display: flex;
  // 子项底部对齐
  align-items: flex-end;
  // 子元素间距 8px
  gap: 8px;
  // 四周内边距左右 12px 上下 8px
  padding: 8px 12px;
  // 底部内边距适配安全区域（如 iPhone 底部横条）
  padding-bottom: max(8px, env(safe-area-inset-bottom));
  // 背景色白色
  background: #fff;
  // 顶部 1px 宽的浅灰色边框线
  border-top: 1px solid #ebedf0;

  // 穿透修改 Vant Field 组件内部样式
  :deep(.van-field) {
    // flex 子项占满剩余空间
    flex: 1;
    // 无内边距
    padding: 0;
    // 背景透明
    background: transparent;
  }

  // 穿透修改 Vant Field 输入控件样式
  :deep(.van-field__control) {
    // 字体大小 14px
    font-size: 14px;
  }
}

// 输入框右侧操作按钮区域样式
.input-actions {
  // 不允许收缩
  flex-shrink: 0;
}
</style>
