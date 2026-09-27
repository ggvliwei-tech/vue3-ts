/**
 * access token 统一刷新模块
 *
 * 为什么必须集中到一处：
 * 修复前存在 4 条各自为政的刷新路径，彼此不知道对方正在刷新：
 *   1. request.ts 的 401 拦截器（有 single-flight 锁）
 *   2. main.ts 启动时的静默续期 scheduleSilentRefresh（无锁）
 *   3. AiChat.vue 的 autoRefreshToken（无锁，3 个调用点各自内联）
 *   4. 页面里直接调用 refreshToken() 的地方
 *
 * 而服务端的 refresh token 是「一次一换」的：每次刷新都会用新值覆盖
 * Redis 里的 RT，且当 Cookie 里的 RT 与 Redis 中的不一致时，
 * 会被判定为令牌盗用 —— 删除会话、拉黑该设备、强制下线。
 * 于是"静默续期刚换完 RT，几乎同时某个请求 401 又去刷新"这种完全正常的时序，
 * 会被服务端当成攻击，把正常用户踢下线。
 *
 * 因此：所有刷新都必须经过 refreshAccessToken()，共享同一个 in-flight Promise。
 * 并发调用只会真正发出一次请求，其余调用复用同一个结果。
 *
 * 跨标签页协调：
 * AT 存在 localStorage，同一浏览器的多个标签页共享同一个 AT，
 * 也就意味着它们的续期定时器会在同一时刻触发。两点处理：
 *  - 调度时加随机抖动，让各标签页错峰触发；
 *  - 监听 storage 事件：别的标签页刷新/登出后本标签页立即跟进，
 *    不必自己再刷一次（重复刷新同样会撞服务端的复用检测）。
 *    storage 事件只在**其他**标签页修改 localStorage 时触发，天然不会自触发。
 */

import { TOKEN_STORAGE_KEY, clearAuth, getToken, getTokenExp, setToken } from './auth-storage'

/** 刷新器与回调由各端注入，避免 shared 反向依赖具体的 api 层 */
export interface AuthRefreshOptions {
  /** 实际调用后端 /user/refresh-token 的函数 */
  refreshFn: () => Promise<{ data: { accessToken: string } }>
  /** 会话确实失效时的回调（清状态后跳登录页） */
  onAuthCleared?: () => void
  /**
   * token 变化时的通知，用于同步 AuthStore 的响应式状态
   * （存储层是 localStorage，Pinia 的 state 不会自己跟着变）
   */
  onTokenChanged?: (token: string) => void
  /** 提前多少毫秒刷新，默认 5 分钟 */
  advanceMs?: number
}

/** 默认提前 5 分钟刷新 */
const DEFAULT_ADVANCE_MS = 5 * 60 * 1000
/** 抖动上限：让多标签页的续期时刻错开，避免并发轮换同一个 RT */
const JITTER_MS = 2000
/** 单次调度延迟上限（24 小时），防止意外长时间挂起 */
const MAX_DELAY_MS = 24 * 60 * 60 * 1000

let refreshFn: AuthRefreshOptions['refreshFn'] | null = null
let onAuthCleared: (() => void) | null = null
let onTokenChanged: ((token: string) => void) | null = null
let advanceMs = DEFAULT_ADVANCE_MS

/** single-flight 锁：非空表示已有刷新在途，后续调用直接复用它 */
let inflight: Promise<string> | null = null
/** 静默续期定时器 */
let timer: ReturnType<typeof setTimeout> | null = null
/** storage 事件监听是否已注册（避免重复 configureAuth 时叠加） */
let storageListenerBound = false

// ====================== 初始化 ======================

/**
 * 配置认证刷新（应在应用启动最早时机调用一次）
 * 同时会启动静默续期（若当前已有 token）
 */
export function configureAuth(options: AuthRefreshOptions): void {
  refreshFn = options.refreshFn
  onAuthCleared = options.onAuthCleared ?? null
  onTokenChanged = options.onTokenChanged ?? null
  if (typeof options.advanceMs === 'number') advanceMs = options.advanceMs
  bindStorageSync()
  scheduleSilentRefresh()
}

/** 认证模块是否已初始化 */
export function isAuthConfigured(): boolean {
  return refreshFn !== null
}

// ====================== 刷新 ======================

/**
 * 刷新 access token（全局唯一入口，内部 single-flight）
 *
 * @returns 新的 access token
 * @throws 刷新失败时抛错，同时已由内部触发 onAuthCleared
 */
export function refreshAccessToken(): Promise<string> {
  if (!refreshFn) {
    return Promise.reject(new Error('认证模块尚未初始化：请先调用 configureAuth()'))
  }
  // 已有刷新在途 → 复用同一个 Promise，不重复发请求
  if (!inflight) {
    inflight = doRefresh().finally(() => {
      inflight = null
    })
  }
  return inflight
}

async function doRefresh(): Promise<string> {
  try {
    const res = await refreshFn!()
    const newToken = res?.data?.accessToken
    if (!newToken) {
      throw new Error('刷新接口未返回 accessToken')
    }
    applyToken(newToken)
    // 按新 token 的 exp 重新排期
    scheduleSilentRefresh()
    return newToken
  } catch (err) {
    // 走到这里说明会话真的结束了（RT 过期 / 被吊销 / 被顶下线），
    // 前端能做的只有清状态并回到登录页
    handleSessionExpired()
    throw err instanceof Error ? err : new Error(String(err))
  }
}

/** 更新 token 并同步给订阅方（AuthStore） */
function applyToken(token: string): void {
  setToken(token)
  onTokenChanged?.(token)
}

/**
 * 会话失效的统一出口：清空认证状态并交给各端跳转登录页
 * 供刷新失败、retry 次数耗尽等"确定无法恢复"的场景调用
 */
export function handleSessionExpired(): void {
  stopSilentRefresh()
  clearAuth()
  onAuthCleared?.()
}

/**
 * 用户主动登出：本地清理 + 通知其他标签页一起登出
 * （RT 在服务端已被吊销，其他标签页留着 AT 也没有意义）
 *
 * 其他标签页通过 storage 事件感知到 token 被清空后自行登出，
 * 不需要额外的广播通道。
 */
export function notifyLogout(): void {
  stopSilentRefresh()
  clearAuth()
}

// ====================== 静默续期 ======================

/**
 * 按当前 token 的 exp 重新安排一次静默续期
 * 每次刷新成功后都会自动重排，无需外部递归调用
 */
export function scheduleSilentRefresh(): void {
  stopSilentRefresh()
  const exp = getTokenExp()
  if (!exp || !getToken()) return

  const base = exp - Date.now() - advanceMs
  // base <= 0 说明已经进入提前窗口（或已过期）：立即刷新且不加抖动，
  // 否则抖动会把它推过 exp，导致这次刷新必然 401
  const delay = base <= 0 ? 0 : base + Math.random() * JITTER_MS
  timer = setTimeout(
    () => {
      timer = null
      // 失败已在 doRefresh 内部处理（清状态 + 跳登录），这里只需吞掉 rejection
      refreshAccessToken().catch(() => {})
    },
    Math.min(delay, MAX_DELAY_MS)
  )
}

/** 停止静默续期（登出 / 会话失效 / 重新配置时调用） */
export function stopSilentRefresh(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

// ====================== 跨标签页同步 ======================

/**
 * 监听 storage 事件，跟进其他标签页的登录态变化
 *
 * storage 事件的语义正好符合需要：只在**其他**标签页修改 localStorage 时触发，
 * 本标签页自己的修改不会回调，因此不存在自触发的循环。
 */
function bindStorageSync(): void {
  if (storageListenerBound) return
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return
  }
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== TOKEN_STORAGE_KEY) return

    const newToken = event.newValue ?? ''
    if (!newToken) {
      // 其他标签页登出 / 会话失效：本标签页一并退出
      stopSilentRefresh()
      onTokenChanged?.('')
      onAuthCleared?.()
      return
    }

    // 其他标签页刷新了 AT：直接采用，并按新 exp 重排本标签页的定时器，
    // 避免本标签页随后又用自己的 RT 刷一次造成并发轮换。
    //
    // 这里不能再用 `newToken !== getToken()` 做判断：localStorage 是同源共享的，
    // 事件到达时本标签页读到的**已经是**新值，该条件恒为 false，整个分支会变成死代码
    // ——结果是 Pinia 里留着旧 AT，定时器也仍按旧 exp 排期。
    // 重复写入同一个值不会引发 storage 事件（规范中 setItem 值未变则不广播），
    // 所以直接采用不存在多标签页互相回写的循环。
    applyToken(newToken)
    scheduleSilentRefresh()
  })
  storageListenerBound = true
}
