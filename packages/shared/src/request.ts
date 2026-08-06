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
}

export interface ApiRes<T = unknown> {
  code: number
  msg: string
  data: T
}

/**
 * 获取环境变量中的 API 地址
 */
function getBaseURL(): string {
  // Vite 使用 import.meta.env
  return (import.meta as any).env?.VITE_API_BASE_URL ?? ''
}

/**
 * 创建请求实例
 */
export function createRequest(config: AxiosRequestConfig = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: getBaseURL(),
    timeout: 15000,
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
      // 业务错误（如参数校验失败），返回 reject 让调用方处理
      return Promise.reject(new Error(data.msg || '请求失败'))
    },
    (error: unknown) => {
      const message = (error as any).response?.data?.msg || (error as Error).message || '网络异常'
      return Promise.reject(new Error(message))
    },
  )

  return instance
}

/** 默认请求实例 */
export const request = createRequest()

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
