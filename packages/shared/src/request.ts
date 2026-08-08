/**
 * HTTP 请求封装模块
 * 基于 axios 封装的统一请求方法
 * 提供标准化的请求拦截、响应处理和错误处理
 */

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios'

export interface RequestConfig extends AxiosRequestConfig {
  /** 是否需要 token，默认 true */
  needToken?: boolean
  /** 是否跳过 token 刷新，默认 false */
  skipRefresh?: boolean
}

export interface ApiRes<T = unknown> {
  code: number
  msg: string
  data: T
}

export interface RefreshTokenRes {
  accessToken: string
}

/**
 * 获取环境变量中的 API 地址
 */
function getBaseURL(): string {
  return (import.meta as any).env?.VITE_API_BASE_URL ?? ''
}

/**
 * 刷新 token 的回调（由各端自行实现）
 */
let onRefreshToken: ((callback: RefreshCallback) => void) | null = null

export type RefreshCallback = (newToken: string | null) => void

/**
 * 设置刷新 token 回调
 */
export function setRefreshTokenCallback(callback: (cb: RefreshCallback) => void) {
  onRefreshToken = callback
}

/**
 * 401 未授权回调（刷新失败时跳转登录页）
 */
let onUnauthorized: (() => void) | null = null

/**
 * 设置未授权回调，用于 token 刷新失败时跳转登录页
 */
export function setUnauthorizedCallback(callback: () => void) {
  onUnauthorized = callback
}

/** 默认请求实例 */
export const request = createRequest()

// 模块级共享的刷新状态，避免多实例竞态条件
let isRefreshing = false
let pendingQueue: Array<(token: string | null) => void> = []

/**
 * 创建请求实例
 */
export function createRequest(config: AxiosRequestConfig = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: getBaseURL(),
    timeout: 15000,
    withCredentials: true, // 允许跨域携带 Cookie（refresh_token）
    ...config,
  })

  // 请求拦截器
  instance.interceptors.request.use(
    (config: AxiosRequestConfig) => {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : ''
      if (token) {
        config.headers = config.headers || {}
        config.headers.Authorization = `Bearer ${token}`
      }
      return config as any
    },
    (error: unknown) => Promise.reject(error),
  )

  // 响应拦截器
  instance.interceptors.response.use(
    (response: AxiosResponse<ApiRes>) => {
      const { data } = response
      if (data.code === 0) {
        return response
      }
      // 401 token 过期，尝试刷新
      if (data.code === 401) {
        const originalConfig = (response as any).config
        if (originalConfig?.skipRefresh) {
          onUnauthorized?.()
          return Promise.reject(new Error(data.msg || '登录已过期'))
        }
        return handle401(originalConfig, instance)
      }
      // 业务错误
      return Promise.reject(new Error(data.msg || '请求失败'))
    },
    (error: unknown) => {
      // HTTP 401
      if ((error as any).response?.status === 401) {
        const originalConfig = (error as any).config
        if (originalConfig?.skipRefresh) {
          onUnauthorized?.()
          return Promise.reject(new Error('登录已过期'))
        }
        return handle401(originalConfig, instance)
      }
      const message = (error as any).response?.data?.msg || (error as Error).message || '网络异常'
      return Promise.reject(new Error(message))
    },
  )

  /**
   * 处理 401 响应：尝试刷新 token 并重试原始请求
   */
  function handle401(
    originalConfig: AxiosRequestConfig,
    axiosInstance: AxiosInstance,
  ): Promise<AxiosResponse<ApiRes>> {
    if (!isRefreshing) {
      isRefreshing = true

      return new Promise((resolve, reject) => {
        // 将当前请求加入等待队列
        pendingQueue.push((newToken: string | null) => {
          if (newToken) {
            originalConfig.headers = originalConfig.headers || {}
            originalConfig.headers.Authorization = `Bearer ${newToken}`
            resolve(axiosInstance.request(originalConfig))
          } else {
            reject(new Error('登录已过期，请重新登录'))
          }
        })

        // 触发刷新 token
        onRefreshToken?.((newToken: string | null) => {
          // 先保存并清空队列，避免新 401 请求被错误处理
          const queue = pendingQueue
          pendingQueue = []
          isRefreshing = false

          // 执行队列
          queue.forEach((cb) => cb(newToken))
        })
      })
    }

    // 已经在刷新中，将请求加入等待队列
    return new Promise((resolve, reject) => {
      pendingQueue.push((newToken: string | null) => {
        if (newToken) {
          originalConfig.headers = originalConfig.headers || {}
          originalConfig.headers.Authorization = `Bearer ${newToken}`
          resolve(axiosInstance.request(originalConfig))
        } else {
          reject(new Error('登录已过期，请重新登录'))
        }
      })
    })
  }

  return instance
}

/**
 * 通用请求方法
 */
export function get<T = unknown>(url: string, config?: RequestConfig): Promise<AxiosResponse<ApiRes<T>>> {
  return request.get<ApiRes<T>>(url, config)
}

export function post<T = unknown>(
  url: string,
  data?: unknown,
  config?: RequestConfig,
): Promise<AxiosResponse<ApiRes<T>>> {
  return request.post<ApiRes<T>>(url, data, config)
}

export function put<T = unknown>(
  url: string,
  data?: unknown,
  config?: RequestConfig,
): Promise<AxiosResponse<ApiRes<T>>> {
  return request.put<ApiRes<T>>(url, data, config)
}

export function del<T = unknown>(url: string, config?: RequestConfig): Promise<AxiosResponse<ApiRes<T>>> {
  return request.delete<ApiRes<T>>(url, config)
}
