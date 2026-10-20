/**
 * 统一的请求错误类型
 *
 * 为什么单独一个模块：`request.ts` 要抛它、`token-refresh.ts` 要按它的 kind 判断
 * 「是不是会话真的结束了」，而 request.ts 已经 import 了 token-refresh（刷新入口）。
 * 如果把这个类放进 request.ts，两个模块就互相 import 形成环 ——
 * 类继承在 ESM 环里会因为 TDZ 报 "Class extends value undefined"，
 * 而且出现时机取决于哪个模块先被求值，属于最难查的那类问题。放独立模块即可根除。
 *
 * 为什么需要分类：
 * 修复前 request.ts 抛的一律是裸 `Error` —— 不挂 status、不挂响应体。
 * 于是网络断开、后端 5xx、401 三种情况到了 token-refresh 里长得**一模一样**，
 * 而那里只有一条无条件分支：清状态 + 跳登录页。
 * 结果就是「刷新时网断了一下」= 用户被踢回登录页，而服务端的 refresh token
 * 其实还好端端地存在 —— 明明等一下重试就能恢复。
 *
 * 分类之后，只有确定「这个会话已经不能用」的情况才走登出流程。
 *
 * 注意 `extends Error` 且保留 `message`：所有既有调用点（`err.message` 提示、
 * AiChat 里按关键字匹配令牌失效文案）都不需要改动，行为向后兼容。
 */
export type ApiErrorKind =
  /** 请求没能到达服务端 / 没收到响应：断网、DNS、超时、被取消 */
  | 'network'
  /** 收到了响应但 HTTP 状态码非 2xx（401 / 500 / 502 …） */
  | 'http'
  /** HTTP 200 但业务码非 0（服务端明确拒绝，msg 里有原因） */
  | 'business'

export interface ApiErrorOptions {
  kind: ApiErrorKind
  /** HTTP 状态码；`network` 时没有 */
  status?: number
  /** 服务端业务码（ApiRes.code）；仅 `business` 时通常有 */
  code?: number
}

export class ApiError extends Error {
  /** 错误类别，供调用方区分「可重试」与「会话已失效」 */
  readonly kind: ApiErrorKind
  /** HTTP 状态码，`kind === 'network'` 时为 undefined */
  readonly status?: number
  /** 服务端业务码，`kind === 'business'` 时通常有值 */
  readonly code?: number

  constructor(message: string, options: ApiErrorOptions) {
    super(message)
    this.name = 'ApiError'
    this.kind = options.kind
    this.status = options.status
    this.code = options.code
  }

  /**
   * 该错误是否**可能**通过重试恢复。
   *
   * 只有网络层失败与服务端 5xx 算可恢复：前者等网络回来即可，后者通常是
   * 后端瞬时故障。4xx 与业务错误是服务端对本次请求的明确否定，重试没有意义。
   */
  get retryable(): boolean {
    if (this.kind === 'network') return true
    return this.kind === 'http' && (this.status ?? 0) >= 500
  }
}

/** 判断任意抛出值是否为 ApiError（跨模块/跨包 instanceof 失效时的兜底） */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}
