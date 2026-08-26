/**
 * HTTP 请求封装模块
 * 基于 axios 封装的统一请求方法
 * 提供标准化的请求拦截、响应处理和错误处理
 */

// 导入 axios 库及其类型定义
import axios, {
  // Axios 实例类型，用于创建自定义请求实例
  type AxiosInstance,
  // 请求配置类型，用于定义请求的参数选项
  type AxiosRequestConfig,
  // 响应类型，用于定义服务器返回的数据结构
  type AxiosResponse,
} from 'axios'

// 扩展 AxiosRequestConfig 的自定义请求配置接口
export interface RequestConfig extends AxiosRequestConfig {
  // 是否需要携带 token，默认为 true
  needToken?: boolean
  // 是否跳过 token 自动刷新逻辑，默认为 false
  skipRefresh?: boolean
}

// 统一 API 响应数据结构接口
// 所有后端接口都遵循此格式
export interface ApiRes<T = unknown> {
  // 状态码，0 表示成功
  code: number
  // 提示信息或错误描述
  msg: string
  // 响应数据，使用泛型支持不同类型
  data: T
}

// 刷新 token 接口的响应数据结构
export interface RefreshTokenRes {
  // 新的访问令牌
  accessToken: string
}

/**
 * 获取环境变量中配置的 API 基础地址
 * @returns API 的 baseURL 字符串
 */
function getBaseURL(): string {
  // 从 Vite 环境变量中读取 API 地址，如果没有则返回空字符串
  return (import.meta as any).env?.VITE_API_BASE_URL ?? ''
}

// 刷新 token 的回调函数，由各端（Web/小程序等）自行实现
let onRefreshToken: ((callback: RefreshCallback) => void) | null = null

// 刷新 token 回调的函数签名定义
// newToken 为新的访问令牌，刷新失败时为 null
export type RefreshCallback = (newToken: string | null) => void

/**
 * 设置刷新 token 的回调函数
 * @param callback 接收 RefreshCallback 参数的回调函数
 */
export function setRefreshTokenCallback(callback: (cb: RefreshCallback) => void) {
  // 将外部传入的刷新逻辑赋值给模块内部变量
  onRefreshToken = callback
}

// 401 未授权时的回调函数，用于刷新失败后跳转登录页等处理
let onUnauthorized: (() => void) | null = null

/**
 * 设置未授权回调函数
 * @param callback token 刷新失败时执行的回调
 */
export function setUnauthorizedCallback(callback: () => void) {
  // 将外部传入的未授权处理逻辑赋值给模块内部变量
  onUnauthorized = callback
}

// 创建默认的全局请求实例
export const request = createRequest()

// 模块级共享的刷新状态标志，防止多实例同时刷新导致竞态条件
let isRefreshing = false
// 等待队列，存放刷新期间挂起的请求回调
let pendingQueue: Array<(token: string | null) => void> = []
// 单个请求的最大重试次数，防止 refreshToken 后再次 401 导致死循环
const MAX_RETRY_COUNT = 1
// 用 WeakMap 追踪每个请求配置的重试次数，避免在 config 对象上添加自定义字段造成污染
const retryCountMap = new WeakMap<AxiosRequestConfig, number>()

/**
 * 创建自定义请求实例的工厂函数
 * @param config 可选的 axios 配置参数
 * @returns 返回配置好的 AxiosInstance 实例
 */
export function createRequest(config: AxiosRequestConfig = {}): AxiosInstance {
  // 使用 axios.create 创建新实例，合并默认配置和自定义配置
  const instance = axios.create({
    // 设置请求的基础 URL，从环境变量获取
    baseURL: getBaseURL(),
    // 设置请求超时时间为 15 秒
    timeout: 15000,
    // 允许跨域请求携带 Cookie，用于 refresh_token 的 httpOnly Cookie 传输
    withCredentials: true,
    // 展开外部传入的配置，可以覆盖以上默认值
    ...config,
  })

  // 注册请求拦截器：在请求发送前执行
  instance.interceptors.request.use(
    // 请求成功回调：在 config 对象上进行预处理
    (config: AxiosRequestConfig) => {
      // 安全地获取 localStorage 中的 token，非浏览器环境下返回空字符串
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : ''
      // 如果 token 存在，则将其添加到请求头中
      if (token) {
        // 确保 headers 对象已初始化
        config.headers = config.headers || {}
        // 在 Authorization 请求头中设置 Bearer token
        config.headers.Authorization = `Bearer ${token}`
      }
      // 返回修改后的配置，继续发送请求
      return config as any
    },
    // 请求失败回调：直接抛出错误
    (error: unknown) => Promise.reject(error),
  )

  // 注册响应拦截器：在收到响应后、then 回调前执行
  instance.interceptors.response.use(
    // 响应成功回调：处理 HTTP 2xx 响应
    (response: AxiosResponse<ApiRes>) => {
      // 解构获取响应体中的 data 字段（即后端返回的 JSON）
      const { data } = response
      // 状态码为 0 表示业务成功，直接返回响应体中的 data 字段（即 TransformInterceptor 包装后的完整数据）
      if (data.code === 0) {
        // 通过类型断言绕过 axios 拦截器签名限制：调用方实际收到的是 ApiRes 对象而非 AxiosResponse
        return data as unknown as AxiosResponse
      }
      // 状态码为 401 表示 token 过期或未授权，尝试自动刷新 token
      if (data.code === 401) {
        // 获取原始请求的配置，用于重试
        const originalConfig = (response as any).config
        // 如果该请求标记了跳过刷新，则直接触发未授权回调
        if (originalConfig?.skipRefresh) {
          // 执行未授权回调（如跳转登录页）
          onUnauthorized?.()
          // 拒绝该请求并返回错误信息
          return Promise.reject(new Error(data.msg || '登录已过期'))
        }
        // 调用 401 处理逻辑，自动刷新 token 并重试请求
        return handle401(originalConfig, instance)
      }
      // 其他非 0 状态码视为业务错误，抛出带错误信息的异常
      return Promise.reject(new Error(data.msg || '请求失败'))
    },
    // 响应失败回调：处理 HTTP 非 2xx 错误
    (error: unknown) => {
      // 判断是否为 HTTP 401 状态码错误
      if ((error as any).response?.status === 401) {
        // 获取原始请求配置
        const originalConfig = (error as any).config
        // 如果标记了跳过刷新，则直接触发未授权回调
        if (originalConfig?.skipRefresh) {
          // 执行未授权回调
          onUnauthorized?.()
          // 拒绝请求
          return Promise.reject(new Error('登录已过期'))
        }
        // 调用 401 处理逻辑尝试刷新 token
        return handle401(originalConfig, instance)
      }
      // 提取错误信息：优先取响应体中的 msg，其次取错误对象的 message，最后使用默认提示
      const message = (error as any).response?.data?.msg || (error as Error).message || '网络异常'
      // 以统一的 Error 对象拒绝
      return Promise.reject(new Error(message))
    },
  )

  /**
   * 处理 401 响应的内部函数
   * 尝试刷新 token 并使用新 token 重试原始请求
   * @param originalConfig 原始请求的配置对象
   * @param axiosInstance axios 实例
   * @returns 返回重试后的响应 Promise
   */
  function handle401(
    originalConfig: AxiosRequestConfig,
    axiosInstance: AxiosInstance,
  ): Promise<AxiosResponse<ApiRes>> {
    // 从 WeakMap 获取当前请求已重试次数
    const currentRetry = retryCountMap.get(originalConfig) || 0

    // 如果已经达到最大重试次数，直接走未授权流程，防止死循环
    if (currentRetry >= MAX_RETRY_COUNT) {
      // 触发未授权回调（清除 token + 跳转登录页）
      onUnauthorized?.()
      // 拒绝该请求并返回明确错误
      return Promise.reject(new Error('刷新token后仍鉴权失败，请重新登录'))
    }

    // 判断当前是否没有在刷新 token
    if (!isRefreshing) {
      // 标记正在刷新 token
      isRefreshing = true

      // 返回一个 Promise，等待刷新完成后再决定继续还是拒绝
      return new Promise((resolve, reject) => {
        // 将当前请求的回调函数推入等待队列
        // 刷新成功后会用新 token 重试，失败则拒绝
        pendingQueue.push((newToken: string | null) => {
          // 如果刷新成功获得新 token
          if (newToken) {
            // 增加重试计数并写回 WeakMap
            retryCountMap.set(originalConfig, currentRetry + 1)
            // 克隆 config 而不是直接 mutate 原对象，避免污染共享配置
            const retryConfig: AxiosRequestConfig = {
              ...originalConfig,
              headers: {
                ...(originalConfig.headers || {}),
                // 用新 token 覆盖 Authorization 头
                Authorization: `Bearer ${newToken}`,
              },
            }
            // 用克隆后的新配置重新发起请求，并将结果 resolve
            resolve(axiosInstance.request(retryConfig))
          } else {
            // 刷新失败（token 为 null），拒绝请求
            reject(new Error('登录已过期，请重新登录'))
          }
        })

        // 触发外部的刷新 token 逻辑
        onRefreshToken?.((newToken: string | null) => {
          // 先保存当前队列的引用，然后清空队列和刷新标志
          // 这样可以避免新产生的 401 请求被错误地加入旧队列
          const queue = pendingQueue
          pendingQueue = []
          isRefreshing = false

          // 依次执行队列中的所有回调，用新 token 重试或拒绝
          queue.forEach((cb) => cb(newToken))
        })
      })
    }

    // 如果已经在刷新中，将当前请求加入等待队列即可
    return new Promise((resolve, reject) => {
      // 将重试逻辑推入等待队列，等刷新完成后统一处理
      pendingQueue.push((newToken: string | null) => {
        // 如果刷新成功获得新 token
        if (newToken) {
          // 增加重试计数并写回 WeakMap
          retryCountMap.set(originalConfig, currentRetry + 1)
          // 克隆 config 而不是直接 mutate 原对象，避免污染共享配置
          const retryConfig: AxiosRequestConfig = {
            ...originalConfig,
            headers: {
              ...(originalConfig.headers || {}),
              // 用新 token 覆盖 Authorization 头
              Authorization: `Bearer ${newToken}`,
            },
          }
          // 用克隆后的新配置重新发起请求，并将结果 resolve
          resolve(axiosInstance.request(retryConfig))
        } else {
          // 刷新失败，拒绝请求
          reject(new Error('登录已过期，请重新登录'))
        }
      })
    })
  }

  // 返回配置好的 axios 实例
  return instance
}

/**
 * 通用 GET 请求方法
 * @param url 请求地址
 * @param config 请求配置
 * @returns 返回包含 API 响应数据的 Promise（已解包，直接是 ApiRes<T>）
 */
export function get<T = unknown>(url: string, config?: RequestConfig): Promise<ApiRes<T>> {
  // 调用默认请求实例的 get 方法，响应拦截器已解包为 ApiRes<T>
  return request.get(url, config) as unknown as Promise<ApiRes<T>>
}

/**
 * 通用 POST 请求方法
 * @param url 请求地址
 * @param data 请求体数据
 * @param config 请求配置
 * @returns 返回包含 API 响应数据的 Promise（已解包，直接是 ApiRes<T>）
 */
export function post<T = unknown>(
  // 请求的目标 URL
  url: string,
  // 发送到服务器的数据
  data?: unknown,
  // 可选的请求配置
  config?: RequestConfig,
): Promise<ApiRes<T>> {
  // 调用默认请求实例的 post 方法，响应拦截器已解包为 ApiRes<T>
  return request.post(url, data, config) as unknown as Promise<ApiRes<T>>
}

/**
 * 通用 PUT 请求方法
 * @param url 请求地址
 * @param data 请求体数据
 * @param config 请求配置
 * @returns 返回包含 API 响应数据的 Promise（已解包，直接是 ApiRes<T>）
 */
export function put<T = unknown>(
  // 请求的目标 URL
  url: string,
  // 用于更新的数据
  data?: unknown,
  // 可选的请求配置
  config?: RequestConfig,
): Promise<ApiRes<T>> {
  // 调用默认请求实例的 put 方法，响应拦截器已解包为 ApiRes<T>
  return request.put(url, data, config) as unknown as Promise<ApiRes<T>>
}

/**
 * 通用 DELETE 请求方法
 * @param url 请求地址
 * @param config 请求配置
 * @returns 返回包含 API 响应数据的 Promise（已解包，直接是 ApiRes<T>）
 */
export function del<T = unknown>(url: string, config?: RequestConfig): Promise<ApiRes<T>> {
  // 调用默认请求实例的 delete 方法（方法名为 delete，导出名为 del 避免关键字冲突），响应拦截器已解包为 ApiRes<T>
  return request.delete(url, config) as unknown as Promise<ApiRes<T>>
}

/**
 * 通用 PATCH 请求方法
 * @param url 请求地址
 * @param data 请求体数据
 * @param config 请求配置
 * @returns 返回包含 API 响应数据的 Promise（已解包，直接是 ApiRes<T>）
 */
export function patch<T = unknown>(
  // 请求的目标 URL
  url: string,
  // 部分更新的数据
  data?: unknown,
  // 可选的请求配置
  config?: RequestConfig,
): Promise<ApiRes<T>> {
  // 调用默认请求实例的 patch 方法，响应拦截器已解包为 ApiRes<T>
  return request.patch(url, data, config) as unknown as Promise<ApiRes<T>>
}

// ============================================================
// JWT Token 解析工具（不验证签名，仅解析 payload）
// ============================================================

/**
 * JWT payload 结构（不完整，按需扩展）
 */
export interface JwtPayload {
  // 用户 ID（subject）
  sub: number
  // 用户名
  username?: string
  // 签发时间（秒）
  iat?: number
  // 过期时间（秒）
  exp?: number
}

/**
 * 解析 JWT payload（不验证签名，仅 base64 解码）
 * @param token JWT 字符串（支持 "Bearer xxx" 或纯 xxx）
 * @returns 解析后的 payload 对象，失败返回 null
 */
export function parseJwt(token: string | null | undefined): JwtPayload | null {
  if (!token) return null
  // 去掉可能的前缀 "Bearer "
  const raw = token.startsWith('Bearer ') ? token.slice(7) : token
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  try {
    // base64url → base64：把 - 替换为 +，_ 替换为 /，补齐 =
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return JSON.parse(atob(padded)) as JwtPayload
  } catch {
    return null
  }
}

/**
 * 从 localStorage 取当前 token 并返回过期时间（毫秒时间戳）
 * @returns 过期时间戳，0 表示无 token 或解析失败
 */
export function getTokenExp(): number {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null
  const payload = parseJwt(token)
  return payload?.exp ? payload.exp * 1000 : 0
}

/**
 * 从 localStorage 取当前 token 并返回 userId
 */
export function getUserIdFromToken(): number {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null
  return parseJwt(token)?.sub ?? 0
}

// ============================================================
// 静默续期：基于 JWT exp 提前 N 分钟主动刷新 token
// ============================================================

/**
 * 静默续期调度器
 *
 * 工作原理：
 *  - 解析当前 token 的 exp 字段
 *  - 在 (exp - advanceMs) 时刻触发 refreshFn
 *  - 成功 → 调用 onToken 写入新 token → 递归调度下一次
 *  - 失败 → 不做任何事（自然 401 流程会接管）
 *
 * @param refreshFn 刷新 token 的异步函数，约定返回 { data: { accessToken } } 或 Promise<{ accessToken }>
 * @param onToken 新 token 回调，调用方需自行持久化（如写 localStorage）
 * @param advanceMs 提前多少毫秒触发刷新，默认 5 分钟
 * @returns cancel 取消调度的函数
 */
export function scheduleSilentRefresh(
  refreshFn: () => Promise<{ data: { accessToken: string } }>,
  onToken: (newToken: string) => void,
  advanceMs: number = 5 * 60 * 1000,
): () => void {
  // 计算下次触发的延迟时间
  const computeDelay = (): number => {
    const exp = getTokenExp()
    if (!exp) return 0
    const remaining = exp - Date.now() - advanceMs
    // 最小 0（即立即触发），最大 24 小时（防止意外长时间挂起）
    return Math.max(0, Math.min(remaining, 24 * 60 * 60 * 1000))
  }

  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const run = async () => {
    if (cancelled) return
    try {
      const res = await refreshFn()
      const newToken = res?.data?.accessToken
      if (newToken) {
        onToken(newToken)
        // 递归调度下次刷新
        if (!cancelled) timer = setTimeout(run, computeDelay())
      }
    } catch {
      // 静默续期失败不做任何处理，让自然 401 接管
    }
  }

  // 仅当 token 存在且 exp 在未来时才调度
  const delay = computeDelay()
  if (delay > 0 && getTokenExp() > 0) {
    timer = setTimeout(run, delay)
  }

  // 返回 cancel 函数
  return () => {
    cancelled = true
    if (timer) clearTimeout(timer)
  }
}
