/**
 * HTTP 请求封装模块
 * 基于 axios 封装的统一请求方法
 * 提供标准化的请求拦截、响应处理和错误处理
 *
 * token 的读取与刷新都收敛到了独立模块，本文件不再自己维护：
 *  - 读取：统一走 auth-storage（与 AuthStore / 路由守卫同源，杜绝"写 A 读 B"）
 *  - 刷新：统一走 token-refresh 的 refreshAccessToken()，内部 single-flight，
 *    并发 401 只会真正发出一次刷新请求，避免撞上服务端的 RT 复用检测
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
// 统一读取 token（唯一真源）
import { getToken } from './auth-storage'
// 统一刷新入口 + 会话失效出口
import { handleSessionExpired, refreshAccessToken } from './token-refresh'

// 扩展 AxiosRequestConfig 的自定义请求配置接口
export interface RequestConfig extends AxiosRequestConfig {
  // 是否需要在请求头携带 token，默认为 true
  needToken?: boolean
  /**
   * 该请求的 401 属于业务错误，不要按"会话过期"处理
   *
   * 用于「本来就没有会话」的请求：登录、注册、忘记密码，以及刷新接口自身
   * （refreshToken 必须带，否则 401 会递归触发刷新）。
   * 反例：登录时密码输错，服务端返回 401，若走会话过期流程，
   * 用户会看到「登录已过期」并被跳转，真正的「用户名或密码错误」永远显示不出来。
   *
   * 新增这类无会话接口时记得一并带上，别只在注释里「用于」。
   */
  skipRefresh?: boolean
  /** 内部使用：该请求已重试次数，随 config 克隆体一起传递 */
  __retryCount?: number
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

/**
 * 获取环境变量中配置的 API 基础地址
 * @returns API 的 baseURL 字符串
 */
function getBaseURL(): string {
  // 从 Vite 环境变量中读取 API 地址，如果没有则返回空字符串
  return (import.meta as any).env?.VITE_API_BASE_URL ?? ''
}

// 创建默认的全局请求实例
export const request = createRequest()

// 单个请求的最大重试次数，防止刷新后再次 401 造成死循环
const MAX_RETRY_COUNT = 1

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
    (config: RequestConfig) => {
      // 从统一存储层读取 token（不再直接读 localStorage，避免与 AuthStore 不一致）
      if (config.needToken !== false) {
        const token = getToken()
        // 如果 token 存在，则将其添加到请求头中
        if (token) {
          config.headers = config.headers || {}
          config.headers.Authorization = `Bearer ${token}`
        }
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
      // 状态码为 0 表示业务成功，直接返回响应体中的 data 字段
      if (data.code === 0) {
        // 通过类型断言绕过 axios 拦截器签名限制：调用方实际收到的是 ApiRes 对象
        return data as unknown as AxiosResponse
      }
      // 状态码为 401 表示 token 过期或未授权
      if (data.code === 401) {
        const originalConfig = (response as any).config as RequestConfig
        // 标记了 skipRefresh 的请求：401 就是业务错误，原样抛给调用方
        if (originalConfig?.skipRefresh) {
          return Promise.reject(new Error(data.msg || '请求失败'))
        }
        return handle401(originalConfig, instance)
      }
      // 其他非 0 状态码视为业务错误，抛出带错误信息的异常
      return Promise.reject(new Error(data.msg || '请求失败'))
    },
    // 响应失败回调：处理 HTTP 非 2xx 错误
    (error: unknown) => {
      const originalConfig = (error as any).config as RequestConfig | undefined
      // 判断是否为 HTTP 401 状态码错误
      if ((error as any).response?.status === 401) {
        // 标记了 skipRefresh 的请求：401 是业务错误（如密码错误），
        // 不能当会话过期处理，否则用户永远看不到真正的错误原因
        if (originalConfig?.skipRefresh) {
          const msg = (error as any).response?.data?.msg || '请求失败'
          return Promise.reject(new Error(msg))
        }
        return handle401(originalConfig ?? {}, instance)
      }
      // 提取错误信息：优先取响应体中的 msg，其次取错误对象的 message，最后使用默认提示
      const message = (error as any).response?.data?.msg || (error as Error).message || '网络异常'
      // 以统一的 Error 对象拒绝
      return Promise.reject(new Error(message))
    },
  )

  /**
   * 处理 401 响应的内部函数
   * 刷新 token 后用新 token 重试原始请求
   *
   * @param originalConfig 原始请求的配置对象
   * @param axiosInstance axios 实例
   * @returns 返回重试后的响应 Promise
   */
  function handle401(
    originalConfig: RequestConfig,
    axiosInstance: AxiosInstance,
  ): Promise<AxiosResponse<ApiRes>> {
    // 重试次数必须从 config 本身读，并且随克隆体一起传给下一次请求。
    // 早先用 WeakMap 以 config 为 key 记录计数，但重试时传的是 `{...config}` 新对象，
    // 于是每次 401 都读到 0 —— 计数形同虚设，刷新后仍 401 会无限重试下去。
    const currentRetry = originalConfig.__retryCount ?? 0

    // 已达最大重试次数：确定无法自动恢复，走会话失效流程（清状态 + 跳登录）
    if (currentRetry >= MAX_RETRY_COUNT) {
      handleSessionExpired()
      return Promise.reject(new Error('登录已过期，请重新登录'))
    }

    // 统一刷新入口：内部 single-flight，并发的多个 401 只会真正刷新一次。
    // 刷新成功后由请求拦截器自动带上最新 token，这里只需把计数传下去。
    return refreshAccessToken().then(
      () => {
        const retryConfig: RequestConfig = {
          ...originalConfig,
          __retryCount: currentRetry + 1,
        }
        return axiosInstance.request(retryConfig) as Promise<AxiosResponse<ApiRes>>
      },
      (err: unknown) => {
        // 刷新失败时 doRefresh 内部已触发 handleSessionExpired，这里只负责拒绝
        const message = err instanceof Error ? err.message : '登录已过期，请重新登录'
        return Promise.reject(new Error(message))
      },
    )
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
 * @param data 用于更新的数据
 * @param config 请求配置
 * @returns 返回包含 API 响应数据的 Promise（已解包，直接是 ApiRes<T>）
 */
export function put<T = unknown>(
  url: string,
  data?: unknown,
  config?: RequestConfig,
): Promise<ApiRes<T>> {
  // 调用默认请求实例的 put 方法
  return request.put(url, data, config) as unknown as Promise<ApiRes<T>>
}

/**
 * 通用 DELETE 请求方法
 * @param url 请求地址
 * @param config 请求配置
 * @returns 返回包含 API 响应数据的 Promise（已解包，直接是 ApiRes<T>）
 */
export function del<T = unknown>(url: string, config?: RequestConfig): Promise<ApiRes<T>> {
  // 方法名为 delete，导出名为 del 避免关键字冲突
  return request.delete(url, config) as unknown as Promise<ApiRes<T>>
}

/**
 * 通用 PATCH 请求方法
 * @param url 请求地址
 * @param data 部分更新的数据
 * @param config 请求配置
 * @returns 返回包含 API 响应数据的 Promise（已解包，直接是 ApiRes<T>）
 */
export function patch<T = unknown>(
  url: string,
  data?: unknown,
  config?: RequestConfig,
): Promise<ApiRes<T>> {
  // 调用默认请求实例的 patch 方法
  return request.patch(url, data, config) as unknown as Promise<ApiRes<T>>
}
