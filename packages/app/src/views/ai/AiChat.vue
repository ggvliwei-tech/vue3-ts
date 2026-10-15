<!-- script setup 块：使用 Composition API 语法糖定义 AI 聊天页面逻辑 -->
<script setup lang="ts">
// 从 vue 中导入 ref（响应式引用）、onMounted 和 onUnmounted（生命周期钩子）
import { ref, onMounted, onUnmounted } from 'vue'
// 从 vue-router 中导入 useRouter 函数用于路由导航
import { useRouter } from 'vue-router'
// 从 AI API 模块中导入会话相关函数
import { createSession, getLastSession, getSessionMessages } from '@/api/ai'
// 权限码常量：模板里的 v-permission="PERM.AI_DOC_PRIVATE" 依赖它，
// 指令本身已在 main.ts 全局注册，这里只需把常量引入当前模板作用域
import { PERM } from '@/permission'
// 从 SSE 工具模块中导入带历史上下文的流式消费函数
import { consumeSSEWithHistory } from '@/utils/sse'
// 统一的 token 刷新入口（single-flight，与 401 拦截器 / 静默续期共用同一次刷新）
import { refreshAccessToken } from '@project/shared/token-refresh'
// 认证状态统一从 auth-storage 读取
import { getToken } from '@project/shared/auth-storage'
// 剪贴板写入封装：非安全上下文（http + 非 localhost）下 navigator.clipboard 不可用，
// 由封装内部回退到 execCommand，调用方只需判返回值
import { copyText } from '@project/shared'
// 从 vant 中导入 showToast 轻提示组件方法
import { showToast, showDialog } from 'vant'
// 导入 MarkdownIt 库用于将 Markdown 渲染为 HTML
import MarkdownIt from 'markdown-it'

// 获取路由导航实例
const router = useRouter()

// 判定「令牌失效」的关键词（必须用多关键词，不能写死一个完整串）
//
// 服务端各处文案并不统一，而且 SSE 走的是原生 fetch（绕开了 axios 拦截器），
// 拿到的只有 HTTP 状态行、不含服务端 msg：
//  - REST（common/guards/jwt-auth.guard.ts）：'Token已过期，请重新登录' / 'Token无效，请重新登录'
//  - WS（modules/chat/chat.gateway.ts）：'Token已过期或无效'
//  - SSE（@/utils/sse.ts 抛出的 Error）：'SSE 请求失败: 401 Unauthorized'
// 此前这里写死 'Token已过期或无效，请重新登录'，服务端从未产出过这个完整串，
// 于是 autoRefreshToken 恒返回 false，整条「刷新后重试」链路是死代码，
// 用户只会看到「流式输出错误：SSE 请求失败: 401 Unauthorized」。
const TOKEN_EXPIRED_KEYWORDS = ['Token已过期', 'Token无效', '登录已过期', 'SSE 请求失败: 401']

/** 判断一段错误文案是否表示令牌失效（见 TOKEN_EXPIRED_KEYWORDS 的说明） */
function isTokenExpiredMsg(msg: string): boolean {
  return TOKEN_EXPIRED_KEYWORDS.some((k) => msg.includes(k))
}

/**
 * 检查是否为 token 过期错误，若是则刷新 token
 *
 * 刷新统一走 refreshAccessToken：它内部 single-flight，与 401 拦截器、
 * 静默续期共享同一次刷新。此前这里直接调用 refreshToken()，
 * 三处刷新路径互不知情，会把同一个 refresh token 并发轮换两次 ——
 * 服务端发现 Cookie 中的 RT 与 Redis 中的不一致时判定为令牌盗用，
 * 删除会话并把用户强制下线。这是"用着用着突然掉线"的直接来源之一。
 *
 * @param msg - 错误消息字符串
 * @returns true 表示是 token 过期且刷新成功
 */
async function autoRefreshToken(msg: string): Promise<boolean> {
  // 不是令牌失效类错误就不动它，交给调用方按普通错误提示
  if (!isTokenExpiredMsg(msg)) return false

  try {
    // 刷新成功后新 token 已由 token-refresh 写入统一存储层，
    // 重试请求会自动带上它，这里无需再自己写 localStorage
    await refreshAccessToken()
    return true
  } catch {
    // 刷新失败：token-refresh 内部已完成状态清理并跳转登录页
    return false
  }
}

/**
 * 用当前（新的）token 重试一次流式请求
 *
 * 抽出来是为了消除原先散落在 onChunk / onError / catch 三处的
 * 近 40 行重复代码 —— 三份拷贝的失败处理稍有出入，容易只改到其中一份。
 *
 * @returns true 表示重试流程已接管（无论最终成功或失败都无需调用方兜底）
 */
async function retryStreamWithToken(
  text: string,
  aiMessageIndex: number,
): Promise<boolean> {
  const newToken = getToken()
  // 拿不到 token 说明刷新并未真正成功，交由调用方走兜底提示
  if (!newToken) return false

  // 必须换成全新的 AbortController，不能复用旧的
  //
  // onChunk 分支在调本函数之前已经 abort 过旧 controller（见下方 "终止当前流式请求"），
  // 而复用那个 signal 会让 fetch 在真正发出请求之前就抛 AbortError；
  // sse.ts 把 AbortError 当成"用户主动取消"静默处理（调 onDone 后 return，不抛错），
  // 于是本函数一路走到 return true，调用方以为重试已接管而跳过错误提示 ——
  // 表现是气泡永久空白且没有任何报错。换新 signal 才能让重试真正发出去。
  const controller = new AbortController()
  abortController = controller

  try {
    await consumeSSEWithHistory(text, sessionId.value, newToken, {
      // 正常接收数据块时追加到 AI 消息中
      onChunk: (chunk) => {
        patchMessage(aiMessageIndex, (msg) => { msg.content += parseSSEData(chunk) })
        scrollToBottomThrottled()
      },
      // 流式完成时的回调
      onDone: () => {
        isStreaming.value = false
        abortController = null
      },
      // 流式出错时的回调
      onError: (err) => {
        // 如果消息内容为空则显示错误提示
        patchMessage(aiMessageIndex, (msg) => {
          if (!msg.content) msg.content = `流式输出错误：${err.message}`
        })
        isStreaming.value = false
        abortController = null
        showToast(err.message || '流式输出失败')
      },
    }, controller.signal)
    return true
  } catch {
    // 重试本身抛错：返回 false，由调用方展示兜底错误
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

// 保存原始 fence（代码块）渲染器
const originalFence = md.renderer.rules.fence!

// 自定义 fence 渲染器：在每个代码块中注入语言标签和复制按钮
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const info = token.info ? token.info.trim() : ''
  const rawHtml = originalFence(tokens, idx, options, env, self)
  // info 是 "```" 之后的整行内容，来自 AI 输出，属于不可信输入。
  // 它会被拼进 HTML 再由 v-html 渲染，必须转义 —— 否则 "```php\"><img src=x onerror=...>"
  // 可闭合属性并注入标签执行脚本（html: false 只挡裸 HTML，挡不住这里的手工拼接）。
  const langLabel = md.utils.escapeHtml(info || 'code')
  const copyBtn = `<button class="code-copy-btn" aria-label="复制代码" type="button"><svg class="code-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span class="code-copy-text">复制</span></button>`
  return rawHtml.replace(/^<pre/, `<pre data-code-block><span class="code-block-lang">${langLabel}</span>${copyBtn}`)
}

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
// 定义当前会话 ID 的响应式数据
const sessionId = ref('')
// 定义是否正在流式输出的响应式数据
const isStreaming = ref(false)
// 定义是否显示恢复上次会话提示的响应式数据
const showResumeHint = ref(false)

// 从组合式函数中导入滚动到底部工具
import { useScrollToBottom as scrollToBottom } from '@/composables/useScrollToBottom'

// 定义聊天容器的 DOM 引用
const chatContainerRef = ref<HTMLDivElement | null>(null)
// 定义 AbortController 用于中断正在进行的 SSE 请求
let abortController: AbortController | null = null

// 代码块「已复制」文案回滚用的定时器（1.5s）。持有引用是为了能在卸载 / 再次点击时取消
let copyResetTimer: ReturnType<typeof setTimeout> | null = null

// 待执行的滚动帧句柄，0 表示当前没有排队的滚动
let scrollRafId = 0

/**
 * 流式输出期间的滚动到底：同一帧内只滚一次。
 *
 * scrollToBottom 读的是 el.scrollHeight —— 布局属性，读它会把整个消息列表
 * 同步重排一遍。而 chunk 的到达频率远高于屏幕刷新率，一秒内可能触发几十上百次，
 * 其中绝大多数对用户没有任何可见差异，纯粹是把主线程按在重排上。
 * 合并到每帧一次即可，行为上仍是"跟着最新内容走"。
 */
function scrollToBottomThrottled() {
  // 本帧已经排过队了，后到的 chunk 不需要再排一次
  if (scrollRafId) return
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = 0
    // useScrollToBottom 内部会先 await nextTick，所以这里不必等 DOM 更新
    void scrollToBottom(chatContainerRef.value)
  })
}

/**
 * 安全地改写指定索引的消息，消息已被移除时静默跳过并返回 false。
 *
 * 为什么需要它：流式回调里捕获的 aiMessageIndex 只是"发送那一刻"的数组下标。
 * 用户在流式输出过程中点了「清空对话」，messages 会被整体置空 —— 后续任何
 * `messages.value[i].content` 都会抛 TypeError。
 *
 * 这条异常链很隐蔽：它在 SSE 的 onChunk 里抛出 → 被 sse.ts 的 catch 转交 onError
 * → onError 里同样的解引用再抛一次 → 最终成为 sendStreamMessage 的未处理 rejection
 * → isStreaming 永远停在 true，输入框保持 disabled、按钮停在「停止」，
 * 用户必须手动点一次「停止」才能恢复。
 *
 * 修复分两层：clearChat 里先中断流（治本，见该函数），这里再兜一层
 * （治标但必要 —— abort 之后仍可能有已入队的 chunk 到达）。
 */
function patchMessage(index: number, mutate: (msg: Message) => void): boolean {
  const msg = messages.value[index]
  if (!msg) return false
  mutate(msg)
  return true
}

// 组件挂载时恢复上次会话
onMounted(async () => {
  // 先从 localStorage 中快速获取缓存的会话 ID
  const cachedSessionId = localStorage.getItem('ai:last_session_id')
  // 如果存在缓存的会话 ID
  if (cachedSessionId) {
    // 将缓存的会话 ID 赋值给响应式变量
    sessionId.value = cachedSessionId
  }
  // 再从服务端验证或更新会话信息
  try {
    // 调用获取最近会话 API
    const res = await getLastSession()
    // 从响应中提取服务端返回的会话 ID（res.data 就是 controller 返回的 { sessionId } 或 null）
    const serverSessionId = res.data?.sessionId
    // 如果服务端有会话 ID
    if (serverSessionId) {
      // 更新当前会话 ID
      sessionId.value = serverSessionId
      // 将新会话 ID 缓存到 localStorage 中
      localStorage.setItem('ai:last_session_id', serverSessionId)
      // 加载该会话的历史消息
      await loadHistoryMessages(serverSessionId)
      // 滚动到底部
      await scrollToBottom(chatContainerRef.value)
    }
  } catch (e) {
    // 获取最近会话失败时打印警告日志
    console.warn('[AI] 获取最近会话失败:', e)
  }
})

// 加载历史消息的异步函数
async function loadHistoryMessages(sid: string) {
  try {
    // 调用 API 获取会话历史消息
    const res = await getSessionMessages(sid)
    // 将历史消息转换为前端消息格式并赋值给消息列表
    if (res.data && res.data.length > 0) {
      // 为基础时间戳（每条消息间隔 1 秒模拟时间）
      const baseTime = Date.now() - res.data.length * 1000
      messages.value = res.data.map((msg, index) => ({
        role: msg.role,
        content: msg.content,
        timestamp: baseTime + index * 1000,
      }))
    }
  } catch (e) {
    // 加载历史消息失败时打印警告日志
    console.warn('[AI] 加载历史消息失败:', e)
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
    // 提取服务端下发的 sessionId
    const newId = res.data?.sessionId
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

/**
 * Markdown 渲染结果缓存，键是消息对象本身。
 *
 * 模板里每条 AI 消息都要调一次 renderMarkdown，而**组件每次重渲染都会把这个调用
 * 重跑一遍**：流式期间每来一个 chunk 会改 messages 里的一条，在输入框里每敲一个字
 * 也会改 inputText（模板里 `!inputText.trim()` 是渲染依赖）。没有缓存时，这两种
 * 情况都会把所有历史 AI 消息的 Markdown 重新解析一遍 —— 代价是「消息条数」倍，
 * 而其中真正变了内容的只有正在流式输出的那一条。
 *
 * 用 WeakMap 而不是往 Message 上加字段：值里存了「上次渲染时的 content」，
 * 下次读取时比对不一致就自动重算。这样无论将来是谁、在哪里改了 content，
 * 都不存在"忘记同步缓存"这种可能。消息被清空（clearChat）后缓存也随对象一起释放。
 */
const markdownCache = new WeakMap<Message, { source: string; html: string }>()

/** 将消息内容渲染为 HTML（带缓存，见 markdownCache 的说明） */
function renderMarkdown(msg: Message): string {
  // 如果内容为空则返回空字符串
  if (!msg.content) return ''
  const cached = markdownCache.get(msg)
  // 命中缓存的唯一条件：这条消息自上次渲染后内容没变过。
  // 注意这里必须真的读一次 msg.content —— 它同时是这次渲染的响应式依赖，
  // 提前 return 掉会让后续 chunk 无法触发重渲染。
  if (cached && cached.source === msg.content) return cached.html
  // 缓存未命中（或内容已变）：用 markdown-it 实例重新渲染
  const html = md.render(msg.content)
  markdownCache.set(msg, { source: msg.content, html })
  return html
}

// 事件委托：处理代码块复制按钮的点击
async function onCodeBlockClick(event: MouseEvent) {
  const target = (event.target as HTMLElement).closest('.code-copy-btn') as HTMLElement | null
  if (!target) return

  const pre = target.closest('pre[data-code-block]') as HTMLElement | null
  if (!pre) return

  const codeEl = pre.querySelector('code')
  if (!codeEl) return

  const text = codeEl.textContent || ''
  if (!text) {
    showToast('代码内容为空')
    return
  }

  const textEl = target.querySelector('.code-copy-text')
  // 走 shared 的 copyText：navigator.clipboard 在非安全上下文（局域网 http 访问，
  // 手机真机联调）下不存在，这里手动兜底的那段逻辑与 AccountBook 里是同一件事，
  // 统一到一处避免两边的兜底行为各自漂移
  const ok = await copyText(text)
  if (!ok) {
    showToast('复制失败，请手动选择')
    return
  }

  target.classList.add('copied')
  if (textEl) textEl.textContent = '已复制'
  showToast('已复制')

  // 记住这个定时器：1.5 秒后要回滚按钮文案，而这段时间里用户完全可能
  // 已经切走页面 / 清空对话让这个 DOM 节点被移除。不清理的话，
  // 定时器仍会准时触发并去改一个已经脱离文档的节点（无异常，但白做）；
  // 组件卸载时更该一并清掉，避免回调里闭包持有的整个消息列表被拖住不释放。
  // 同一个按钮连点多次时，先取消上一个，否则先触发的那个会提前把文案重置回去。
  if (copyResetTimer) clearTimeout(copyResetTimer)
  copyResetTimer = setTimeout(() => {
    copyResetTimer = null
    target.classList.remove('copied')
    if (textEl) textEl.textContent = '复制'
  }, 1500)
}

// 流式发送消息的异步函数（打字机效果）
async function sendStreamMessage() {
  // 获取输入框中的文本并去除首尾空格
  const text = inputText.value.trim()
  // 文本为空或正在流式输出时直接返回（发送键此时也已被禁用）
  if (!text || isStreaming.value) return

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
  await scrollToBottom(chatContainerRef.value)

  // 记录即将创建的 AI 消息在列表中的索引位置
  const aiMessageIndex = messages.value.length
  // 添加一个空的 AI 消息占位符用于后续逐字填充
  messages.value.push({
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
  })
  // 滚动到底部
  await scrollToBottom(chatContainerRef.value)

  // 从统一存储层获取当前 token
  const token = getToken()
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
        // 检测 SSE 数据块是否表示令牌失效
        if (isTokenExpiredMsg(parsed)) {
          // 清除已追加的 token 过期内容
          patchMessage(aiMessageIndex, (msg) => { msg.content = '' })
          // 终止当前流式请求
          abortController?.abort()
          // 刷新 token 后重试一次（刷新走全局统一入口，不会与其他路径并发轮换 RT）
          if (
            (await autoRefreshToken(parsed)) &&
            (await retryStreamWithToken(text, aiMessageIndex))
          ) {
            return
          }
          // token 刷新也失败时显示提示
          patchMessage(aiMessageIndex, (msg) => { msg.content = 'Token 刷新失败，请重新登录' })
          isStreaming.value = false
          abortController = null
          showToast('Token 刷新失败')
          return
        }
        // 正常内容：将解析后的数据追加到 AI 消息中
        patchMessage(aiMessageIndex, (msg) => { msg.content += parsed })
        scrollToBottomThrottled()
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
        // token 过期：刷新后重试一次，成功则本轮回调结束
        if (
          (await autoRefreshToken(error.message)) &&
          (await retryStreamWithToken(text, aiMessageIndex))
        ) {
          return
        }

        // 如果消息内容为空则显示错误提示
        patchMessage(aiMessageIndex, (msg) => {
          if (!msg.content) msg.content = `流式输出错误：${error.message}`
        })
        // 重置流式输出状态
        isStreaming.value = false
        // 清空 AbortController 引用
        abortController = null
        // 显示错误提示
        showToast(error.message || '流式输出失败')
      },
    }, abortController.signal)
  } catch (err: any) {
    // token 过期：刷新后重试一次，成功则本函数结束
    if (
      (await autoRefreshToken(err.message)) &&
      (await retryStreamWithToken(text, aiMessageIndex))
    ) {
      return
    }

    // 如果消息内容为空则显示错误提示
    patchMessage(aiMessageIndex, (msg) => {
      if (!msg.content) msg.content = `请求失败：${err.message}`
    })
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
  // 清引用：留着它会让下一次 sendStreamMessage 之前的旧 signal 状态残留
  abortController = null
  // 重置流式输出状态
  isStreaming.value = false
}

// 清空对话的函数
async function clearChat() {
  try {
    // 弹出二次确认弹窗
    await showDialog({
      title: '确认清空',
      message: '确定要清空当前对话吗？清空后将开启新的对话。',
      showCancelButton: true,
      confirmButtonText: '清空',
      cancelButtonText: '取消',
    })
  } catch {
    // 用户点击取消，直接返回
    return
  }

  // 用户确认后执行清空操作
  //
  // 必须先中断正在进行的流式请求，再清空数组 —— 顺序反了会卡死页面：
  // 流没停时下一个 chunk 会去写 messages.value[aiMessageIndex]，
  // 而数组已被置空，该下标是 undefined；异常在 SSE 回调里抛出并被转交 onError，
  // onError 里同样的解引用再抛一次，最终成为未处理的 rejection，
  // isStreaming 停在 true → 输入框与发送按钮永久 disabled。
  // （patchMessage 已兜住越界，这里是治本：不让流继续跑下去）
  stopStreaming()
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
  // 取消「已复制」文案的回滚定时器。不清的话，1.5s 后回调仍会执行，
  // 去操作一个已经卸载的 DOM 节点（target 与 textEl 都已脱离文档）
  if (copyResetTimer) {
    clearTimeout(copyResetTimer)
    copyResetTimer = null
  }
  // 取消排队中的滚动帧。留着它虽然不会出错（chatContainerRef 已为 null，
  // 回调里是空操作），但没必要让一个已卸载组件的闭包多存活一帧
  if (scrollRafId) {
    cancelAnimationFrame(scrollRafId)
    scrollRafId = 0
  }
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
      <!-- 右侧插槽：我的资料入口 + 清空对话 -->
      <template #right>
        <!-- 我的资料：上传 PDF 后提问时 AI 会一并检索，仅本人可见。
             受 ai:doc:private 控制；没这个权限的用户后端也会拒（403），
             这里用 v-permission 提前把入口摘掉，免得点进去只看到报错。 -->
        <van-icon
          v-permission="PERM.AI_DOC_PRIVATE"
          name="records"
          size="20"
          class="nav-icon"
          @click="router.push('/my-documents')"
        />
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
            @click="onCodeBlockClick"
            v-html="renderMarkdown(msg)"
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
        <!-- 非流式（即未在输出）时显示发送按钮 -->
        <van-button
          v-else
          type="primary"
          size="small"
          round
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

  // 带复制按钮的代码块容器
  pre[data-code-block] {
    // 相对定位，用于子元素绝对定位
    position: relative;
    // 顶部内边距留出语言标签和复制按钮空间
    padding-top: 36px;

    // 语言标签
    .code-block-lang {
      // 绝对定位在左上角
      position: absolute;
      top: 0;
      left: 12px;
      // 小字号
      font-size: 11px;
      // 灰色文字
      color: #636d83;
      // 等宽字体
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      // 垂直内边距
      padding: 4px 0;
    }

    // 复制按钮
    .code-copy-btn {
      // 绝对定位在右上角
      position: absolute;
      top: 4px;
      right: 8px;
      // flex 布局
      display: flex;
      // 垂直居中
      align-items: center;
      // 图标和文字间距
      gap: 4px;
      // 半透明背景
      background: rgba(255, 255, 255, 0.08);
      // 边框
      border: 1px solid rgba(255, 255, 255, 0.12);
      // 圆角
      border-radius: 6px;
      // 内边距
      padding: 4px 8px;
      // 文字颜色
      color: #abb2bf;
      // 小字号
      font-size: 11px;
      // 鼠标指针
      cursor: pointer;
      // 默认隐藏
      opacity: 0;
      // 过渡动画
      transition: opacity 0.2s ease, background 0.2s ease;
      // 去除移动端点击高亮
      -webkit-tap-highlight-color: transparent;
      // 去除默认轮廓
      outline: none;

      // 悬停或激活时显示
      &:active,
      &:hover {
        opacity: 1;
        background: rgba(255, 255, 255, 0.15);
      }

      // 已复制状态
      &.copied {
        opacity: 1;
        background: rgba(86, 182, 100, 0.2);
        border-color: rgba(86, 182, 100, 0.4);
        color: #56b664;
      }
    }

    // 复制图标
    .code-copy-icon {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    // 复制文字
    .code-copy-text {
      white-space: nowrap;
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
