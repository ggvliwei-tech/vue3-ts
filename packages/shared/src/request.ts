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
      // 状态码为 0 表示业务成功，直接返回响应
      if (data.code === 0) {
        return response
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
            // 确保 headers 对象已初始化
            originalConfig.headers = originalConfig.headers || {}
            // 用新 token 更新 Authorization 请求头
            originalConfig.headers.Authorization = `Bearer ${newToken}`
            // 用新配置重新发起请求，并将结果 resolve
            resolve(axiosInstance.request(originalConfig))
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
          // 确保 headers 对象已初始化
          originalConfig.headers = originalConfig.headers || {}
          // 用新 token 更新 Authorization 请求头
          originalConfig.headers.Authorization = `Bearer ${newToken}`
          // 用新配置重新发起请求，并将结果 resolve
          resolve(axiosInstance.request(originalConfig))
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
 * @returns 返回包含 API 响应的 Promise
 */
export function get<T = unknown>(url: string, config?: RequestConfig): Promise<AxiosResponse<ApiRes<T>>> {
  // 调用默认请求实例的 get 方法
  return request.get<ApiRes<T>>(url, config)
}

/**
 * 通用 POST 请求方法
 * @param url 请求地址
 * @param data 请求体数据
 * @param config 请求配置
 * @returns 返回包含 API 响应的 Promise
 */
export function post<T = unknown>(
  // 请求的目标 URL
  url: string,
  // 发送到服务器的数据
  data?: unknown,
  // 可选的请求配置
  config?: RequestConfig,
): Promise<AxiosResponse<ApiRes<T>>> {
  // 调用默认请求实例的 post 方法
  return request.post<ApiRes<T>>(url, data, config)
}

/**
 * 通用 PUT 请求方法
 * @param url 请求地址
 * @param data 请求体数据
 * @param config 请求配置
 * @returns 返回包含 API 响应的 Promise
 */
export function put<T = unknown>(
  // 请求的目标 URL
  url: string,
  // 用于更新的数据
  data?: unknown,
  // 可选的请求配置
  config?: RequestConfig,
): Promise<AxiosResponse<ApiRes<T>>> {
  // 调用默认请求实例的 put 方法
  return request.put<ApiRes<T>>(url, data, config)
}

/**
 * 通用 DELETE 请求方法
 * @param url 请求地址
 * @param config 请求配置
 * @returns 返回包含 API 响应的 Promise
 */
export function del<T = unknown>(url: string, config?: RequestConfig): Promise<AxiosResponse<ApiRes<T>>> {
  // 调用默认请求实例的 delete 方法（方法名为 delete，导出名为 del 避免关键字冲突）
  return request.delete<ApiRes<T>>(url, config)
}

/**
 * 通用 PATCH 请求方法
 * @param url 请求地址
 * @param data 请求体数据
 * @param config 请求配置
 * @returns 返回包含 API 响应的 Promise
 */
export function patch<T = unknown>(
  // 请求的目标 URL
  url: string,
  // 部分更新的数据
  data?: unknown,
  // 可选的请求配置
  config?: RequestConfig,
): Promise<AxiosResponse<ApiRes<T>>> {
  // 调用默认请求实例的 patch 方法
  return request.patch<ApiRes<T>>(url, data, config)
}
