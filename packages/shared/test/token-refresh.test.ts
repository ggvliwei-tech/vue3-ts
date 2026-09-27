/**
 * token-refresh 单元测试
 *
 * 这个模块存在的意义就是"全局唯一刷新入口"，所以测试重点是：
 *  - single-flight：并发调用只真正发一次请求。
 *    修复前有 4 条各自为政的刷新路径，同一个 RT 被并发轮换两次，
 *    服务端据此判定为令牌盗用 → 删会话 + 拉黑设备 → 用户被强制下线。
 *  - 失败即清状态，不留"看似已登录"的假象。
 *  - 跨标签页同步：storage 事件只在其他标签页触发，天然不会自触发循环。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeJwt } from './helpers'

type AuthStorage = typeof import('../src/auth-storage')
type TokenRefresh = typeof import('../src/token-refresh')

let storage: AuthStorage
let mod: TokenRefresh

/** 本测试内注册的 storage 监听器，afterEach 需清理（见 beforeEach 注释） */
const storageListeners: EventListener[] = []

/** 派发一个 storage 事件，模拟「其他标签页」改动了 localStorage */
function dispatchStorage(key: string, newValue: string | null): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}

beforeEach(async () => {
  // 每个用例都拿全新的模块实例：token-refresh 持有 inflight / timer 等模块级状态，
  // 复用实例会让用例之间互相污染
  vi.resetModules()
  localStorage.clear()
  storageListeners.length = 0

  // resetModules 之后旧模块注册在 window 上的监听器依然存在，
  // 它们闭包引用的是旧模块的状态，会干扰后续用例 —— 这里记录下来统一清理
  const realAddEventListener = window.addEventListener.bind(window)
  vi.spyOn(window, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListener,
    options?: unknown
  ) => {
    if (type === 'storage') storageListeners.push(listener)
    realAddEventListener(type, listener, options as AddEventListenerOptions)
  }) as typeof window.addEventListener)

  storage = await import('../src/auth-storage')
  mod = await import('../src/token-refresh')
})

afterEach(() => {
  for (const listener of storageListeners) {
    window.removeEventListener('storage', listener)
  }
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('refreshAccessToken', () => {
  it('未初始化时直接拒绝，并提示先调用 configureAuth', async () => {
    await expect(mod.refreshAccessToken()).rejects.toThrow(/configureAuth/)
  })

  it('并发调用只真正发起一次刷新请求（single-flight）', async () => {
    const refreshFn = vi.fn().mockResolvedValue({ data: { accessToken: 'at-new' } })
    mod.configureAuth({ refreshFn })

    const results = await Promise.all([
      mod.refreshAccessToken(),
      mod.refreshAccessToken(),
      mod.refreshAccessToken(),
    ])

    expect(refreshFn).toHaveBeenCalledTimes(1)
    // 三个调用必须拿到同一个结果，否则会各自持有不同的 AT
    expect(results).toEqual(['at-new', 'at-new', 'at-new'])
  })

  it('刷新成功后写入存储并通知订阅方', async () => {
    const onTokenChanged = vi.fn()
    mod.configureAuth({
      refreshFn: vi.fn().mockResolvedValue({ data: { accessToken: 'at-new' } }),
      onTokenChanged,
    })

    await expect(mod.refreshAccessToken()).resolves.toBe('at-new')

    expect(storage.getToken()).toBe('at-new')
    expect(onTokenChanged).toHaveBeenCalledWith('at-new')
  })

  it('一次刷新结束后释放锁，后续调用能再次刷新', async () => {
    const refreshFn = vi
      .fn()
      .mockResolvedValueOnce({ data: { accessToken: 'at-1' } })
      .mockResolvedValueOnce({ data: { accessToken: 'at-2' } })
    mod.configureAuth({ refreshFn })

    await mod.refreshAccessToken()
    await mod.refreshAccessToken()

    expect(refreshFn).toHaveBeenCalledTimes(2)
    expect(storage.getToken()).toBe('at-2')
  })

  it('刷新失败时清空认证状态并通知各端回登录页', async () => {
    const onAuthCleared = vi.fn()
    storage.setToken('at-old')
    storage.setUserInfo({ id: 1, username: 'alice' })
    mod.configureAuth({
      refreshFn: vi.fn().mockRejectedValue(new Error('401')),
      onAuthCleared,
    })

    await expect(mod.refreshAccessToken()).rejects.toThrow('401')

    expect(onAuthCleared).toHaveBeenCalledTimes(1)
    expect(storage.getToken()).toBe('')
    expect(storage.getUserInfo()).toBeNull()
  })

  it('刷新接口没返回 accessToken 时按失败处理', async () => {
    const onAuthCleared = vi.fn()
    mod.configureAuth({
      refreshFn: vi.fn().mockResolvedValue({ data: {} }),
      onAuthCleared,
    })

    await expect(mod.refreshAccessToken()).rejects.toThrow(/未返回 accessToken/)
    expect(onAuthCleared).toHaveBeenCalledTimes(1)
  })
})

describe('handleSessionExpired / notifyLogout', () => {
  it('handleSessionExpired 清空状态并回调', () => {
    const onAuthCleared = vi.fn()
    storage.setToken('at')
    mod.configureAuth({ refreshFn: vi.fn(), onAuthCleared })

    mod.handleSessionExpired()

    expect(storage.getToken()).toBe('')
    expect(onAuthCleared).toHaveBeenCalledTimes(1)
  })

  it('notifyLogout 清空本地状态', () => {
    storage.setToken('at')
    storage.setUserInfo({ id: 1, username: 'alice' })
    mod.configureAuth({ refreshFn: vi.fn() })

    mod.notifyLogout()

    expect(storage.getToken()).toBe('')
    expect(storage.getUserInfo()).toBeNull()
  })
})

describe('跨标签页同步（storage 事件）', () => {
  it('其他标签页登出后本标签页一并退出', () => {
    const onAuthCleared = vi.fn()
    storage.setToken('at')
    mod.configureAuth({ refreshFn: vi.fn(), onAuthCleared })

    // storage 事件的真实语义：localStorage 同源共享，事件到达时本标签页读到的
    // **已经是**被改动后的值，事件本身只负责"通知"。因此这里必须先真实删掉再派发，
    // 否则模拟出的场景并不存在。
    localStorage.removeItem(storage.TOKEN_STORAGE_KEY)
    dispatchStorage(storage.TOKEN_STORAGE_KEY, null)

    expect(onAuthCleared).toHaveBeenCalledTimes(1)
    // 状态清理交给各端的 onAuthCleared（内部 clearAuth + 跳登录页）
    expect(storage.getToken()).toBe('')
  })

  it('其他标签页刷新了 token 时直接采用，不自己再刷一次', () => {
    const onTokenChanged = vi.fn()
    const refreshFn = vi.fn()
    storage.setToken('at-old')
    mod.configureAuth({ refreshFn, onTokenChanged })

    // 同上：先让 localStorage 呈现"其他标签页已写入"的状态，再派发通知
    localStorage.setItem(storage.TOKEN_STORAGE_KEY, 'at-from-other-tab')
    dispatchStorage(storage.TOKEN_STORAGE_KEY, 'at-from-other-tab')

    expect(storage.getToken()).toBe('at-from-other-tab')
    expect(onTokenChanged).toHaveBeenCalledWith('at-from-other-tab')
    // 关键：不能再顺手刷一次，否则两个标签页会并发轮换同一个 RT
    expect(refreshFn).not.toHaveBeenCalled()
  })

  it('忽略与 token 无关的 storage 变化', () => {
    const onTokenChanged = vi.fn()
    mod.configureAuth({ refreshFn: vi.fn(), onTokenChanged })

    dispatchStorage('some:other:key', 'whatever')

    expect(onTokenChanged).not.toHaveBeenCalled()
  })
})

describe('静默续期', () => {
  it('进入提前窗口后自动刷新', async () => {
    vi.useFakeTimers()
    // 还剩 6 分钟过期，提前 5 分钟刷新 → 约 1 分钟后触发
    const exp = Math.floor(Date.now() / 1000) + 6 * 60
    const refreshFn = vi.fn().mockResolvedValue({ data: { accessToken: 'at-new' } })
    storage.setToken(makeJwt({ sub: 1, exp }))

    mod.configureAuth({ refreshFn, advanceMs: 5 * 60 * 1000 })
    expect(refreshFn).not.toHaveBeenCalled()

    // 多推进 10 秒，覆盖抖动上限（JITTER_MS = 2000）
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000 + 10_000)

    expect(refreshFn).toHaveBeenCalledTimes(1)
  })

  it('没有 token 时不安排续期', async () => {
    vi.useFakeTimers()
    const refreshFn = vi.fn()
    mod.configureAuth({ refreshFn })

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

    expect(refreshFn).not.toHaveBeenCalled()
  })

  it('stopSilentRefresh 能取消已安排的续期', async () => {
    vi.useFakeTimers()
    const exp = Math.floor(Date.now() / 1000) + 60
    const refreshFn = vi.fn()
    storage.setToken(makeJwt({ sub: 1, exp }))
    mod.configureAuth({ refreshFn, advanceMs: 5 * 60 * 1000 })

    mod.stopSilentRefresh()
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

    expect(refreshFn).not.toHaveBeenCalled()
  })
})
