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
type ApiErrorModule = typeof import('../src/api-error')

let storage: AuthStorage
let mod: TokenRefresh
/**
 * ApiError 必须从**当前这一代**模块注册表里取，不能用文件顶部的静态 import。
 *
 * beforeEach 里的 vi.resetModules() 会让 `await import('../src/token-refresh')`
 * 连同它的依赖 api-error 一起重新求值，于是 token-refresh 内部用的
 * ApiError 与静态 import 拿到的是**两个不同的类**，`instanceof` 恒为 false ——
 * token-refresh 会把所有失败都当成"无法分类"，全部走登出流程，
 * 而真正的分类逻辑根本没被测到（表现为 5 个可恢复失败的用例集体失败）。
 * 生产环境只有一份模块实例，不存在这个问题；这里必须跟着测试的重置节奏走。
 */
let ApiErrorClass: ApiErrorModule['ApiError']

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
  // 与 mod 同一代（见 ApiErrorClass 的说明）
  ApiErrorClass = (await import('../src/api-error')).ApiError
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

  // ---------- 可恢复失败：不能因为一次网络抖动就把用户踢下线 ----------
  //
  // 回归：此前 doRefresh 的 catch 是无条件 handleSessionExpired()，注释还写着
  // "走到这里说明会话真的结束了"。实际只要刷新请求碰上断网 / 超时 / 后端 5xx，
  // 用户就被清掉本地状态并跳回登录页 —— 而服务端的 refresh token 完好无损，
  // 过一会儿重试本就能恢复。

  it('刷新碰上网络错误时保留登录态，不跳登录页', async () => {
    const onAuthCleared = vi.fn()
    storage.setToken('at-old')
    storage.setUserInfo({ id: 1, username: 'alice' })
    mod.configureAuth({
      refreshFn: vi.fn().mockRejectedValue(new ApiErrorClass('Network Error', { kind: 'network' })),
      onAuthCleared,
    })

    await expect(mod.refreshAccessToken()).rejects.toThrow('Network Error')

    // 关键：这三项都不该被动过
    expect(onAuthCleared).not.toHaveBeenCalled()
    expect(storage.getToken()).toBe('at-old')
    expect(storage.getUserInfo()).toEqual({ id: 1, username: 'alice' })
  })

  it.each([500, 502, 503])('刷新碰上服务端 %s 时同样保留登录态', async (status) => {
    const onAuthCleared = vi.fn()
    storage.setToken('at-old')
    mod.configureAuth({
      refreshFn: vi
        .fn()
        .mockRejectedValue(new ApiErrorClass('服务暂时不可用', { kind: 'http', status })),
      onAuthCleared,
    })

    await expect(mod.refreshAccessToken()).rejects.toThrow('服务暂时不可用')

    expect(onAuthCleared).not.toHaveBeenCalled()
    expect(storage.getToken()).toBe('at-old')
  })

  it('刷新返回 401（RT 过期/被吊销）时清状态回登录页', async () => {
    const onAuthCleared = vi.fn()
    storage.setToken('at-old')
    mod.configureAuth({
      refreshFn: vi
        .fn()
        .mockRejectedValue(new ApiErrorClass('Token已过期，请重新登录', { kind: 'http', status: 401 })),
      onAuthCleared,
    })

    await expect(mod.refreshAccessToken()).rejects.toThrow()

    expect(onAuthCleared).toHaveBeenCalledTimes(1)
    expect(storage.getToken()).toBe('')
  })

  it('刷新被服务端以业务码拒绝时清状态回登录页', async () => {
    const onAuthCleared = vi.fn()
    storage.setToken('at-old')
    mod.configureAuth({
      refreshFn: vi
        .fn()
        .mockRejectedValue(new ApiErrorClass('账号已被禁用', { kind: 'business', status: 200, code: 403 })),
      onAuthCleared,
    })

    await expect(mod.refreshAccessToken()).rejects.toThrow('账号已被禁用')

    expect(onAuthCleared).toHaveBeenCalledTimes(1)
    expect(storage.getToken()).toBe('')
  })

  it('无法分类的抛出值按会话结束处理（保守失败，不留下刷不动的僵死态）', async () => {
    // refreshFn 绕开了统一请求层时拿不到任何分类信息。此时沿用修复前的行为：
    // 宁可让用户重新登录，也不要留着一个刷不动又永远不退出的登录态。
    const onAuthCleared = vi.fn()
    storage.setToken('at-old')
    mod.configureAuth({
      refreshFn: vi.fn().mockRejectedValue(new Error('谁也说不清这是什么错')),
      onAuthCleared,
    })

    await expect(mod.refreshAccessToken()).rejects.toThrow('谁也说不清这是什么错')

    expect(onAuthCleared).toHaveBeenCalledTimes(1)
    expect(storage.getToken()).toBe('')
  })

  it('可恢复失败后会另排一次重试，而不是就此停摆', async () => {
    vi.useFakeTimers()
    const refreshFn = vi
      .fn()
      .mockRejectedValueOnce(new ApiErrorClass('Network Error', { kind: 'network' }))
      .mockResolvedValueOnce({ data: { accessToken: 'at-new' } })
    storage.setToken('at-old')
    mod.configureAuth({ refreshFn })

    await mod.refreshAccessToken().catch(() => {})
    expect(refreshFn).toHaveBeenCalledTimes(1)

    // 等到重试间隔（30s）过去
    await vi.advanceTimersByTimeAsync(31 * 1000)

    // 第二次成功，token 被更新 —— 证明"断网恢复后能自愈"
    expect(refreshFn).toHaveBeenCalledTimes(2)
    expect(storage.getToken()).toBe('at-new')
  })

  it('会话结束后不排重试', async () => {
    vi.useFakeTimers()
    const refreshFn = vi
      .fn()
      .mockRejectedValue(new ApiErrorClass('Token已过期', { kind: 'http', status: 401 }))
    storage.setToken('at-old')
    mod.configureAuth({ refreshFn })

    await mod.refreshAccessToken().catch(() => {})
    await vi.advanceTimersByTimeAsync(60 * 1000)

    // 已经登出了，不该再有定时器去打服务端
    expect(refreshFn).toHaveBeenCalledTimes(1)
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

  // 回归：主动登出也必须走 onAuthCleared
  //
  // 此前 notifyLogout 只清 localStorage 不回调，导致两件事：
  //  1) Pinia 里的响应式状态是陈旧的（存储层清了，store 不会自己跟着变）
  //  2) app 端注册在 onAuthCleared 里的 disconnectWebSocket() 不会被调用，
  //     登出后 socket 仍以旧 JWT 存活，服务端 presence 一直显示该用户在线
  it('notifyLogout 会触发 onAuthCleared（登出需断开长连接 / 清 Pinia）', () => {
    const onAuthCleared = vi.fn()
    storage.setToken('at')
    mod.configureAuth({ refreshFn: vi.fn(), onAuthCleared })

    mod.notifyLogout()

    expect(onAuthCleared).toHaveBeenCalledTimes(1)
  })

  // 反向约束：onAuthCleared 回调本身不能再次触发 notifyLogout，
  // 否则「登出 → 回调 → 登出」会递归。这里用真实回调形态验证只执行一轮。
  it('notifyLogout 不会因回调而递归', () => {
    let calls = 0
    storage.setToken('at')
    mod.configureAuth({
      refreshFn: vi.fn(),
      onAuthCleared: () => {
        calls += 1
      },
    })

    mod.notifyLogout()

    expect(calls).toBe(1)
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
