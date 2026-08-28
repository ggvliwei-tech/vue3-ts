/**
 * 统一业务状态码枚举
 *
 * 设计原则：
 *  - 0       成功
 *  - 1xxxxx  业务错误（用户/参数/权限等，4xx 语义）
 *  - 2xxxxx  系统错误（基础设施/未捕获异常，5xx 语义）
 *
 * 与 HTTP 状态码解耦：
 *  - 前端只需判断 code === 0 判定成功
 *  - msg 始终是中文化的、可直接展示给用户的文案
 *  - data 在错误时为 null，便于前端类型守卫
 */

export enum BusinessCode {
  /** 成功 */
  SUCCESS = 0,

  // ===== 1xxxxx：业务错误（HTTP 400-499） =====

  /** 通用业务错误（默认 fallback） */
  BUSINESS_ERROR = 10000,
  /** 参数校验失败 */
  PARAM_INVALID = 10001,
  /** 资源不存在 */
  NOT_FOUND = 10002,
  /** 资源冲突（如用户名已存在） */
  CONFLICT = 10003,

  /** 未登录 / Token 缺失或无效 */
  UNAUTHORIZED = 10100,
  /** Token 已过期 */
  TOKEN_EXPIRED = 10101,
  /** RefreshToken 无效或被吊销 */
  REFRESH_TOKEN_INVALID = 10102,
  /** 账号在另一处被强制下线 */
  TOKEN_BLACKLISTED = 10103,

  /** 权限不足 */
  FORBIDDEN = 10200,
  /** 缺少特定权限码 */
  PERMISSION_DENIED = 10201,
  /** 角色不允许（如禁用 admin 角色） */
  ROLE_FORBIDDEN = 10202,

  /** 账号相关 */
  USER_NOT_FOUND = 11001,
  USER_DISABLED = 11002,
  USER_PASSWORD_ERROR = 11003,
  USER_LOCKED = 11004,
  USER_ALREADY_EXISTS = 11005,

  // ===== 2xxxxx：系统错误（HTTP 500） =====

  /** 系统内部错误 */
  INTERNAL_ERROR = 20000,
  /** 数据库错误 */
  DATABASE_ERROR = 20100,
  /** 缓存错误 */
  CACHE_ERROR = 20200,
  /** 第三方服务错误（OSS/AI/SMS） */
  UPSTREAM_ERROR = 20300,
}

/** 业务码 → HTTP 状态码 映射 */
export const BusinessCodeToHttpStatus: Record<number, number> = {
  [BusinessCode.SUCCESS]: 200,
  [BusinessCode.PARAM_INVALID]: 400,
  [BusinessCode.NOT_FOUND]: 404,
  [BusinessCode.CONFLICT]: 409,
  [BusinessCode.UNAUTHORIZED]: 401,
  [BusinessCode.TOKEN_EXPIRED]: 401,
  [BusinessCode.REFRESH_TOKEN_INVALID]: 401,
  [BusinessCode.TOKEN_BLACKLISTED]: 401,
  [BusinessCode.FORBIDDEN]: 403,
  [BusinessCode.PERMISSION_DENIED]: 403,
  [BusinessCode.ROLE_FORBIDDEN]: 403,
  [BusinessCode.USER_NOT_FOUND]: 404,
  [BusinessCode.USER_DISABLED]: 403,
  [BusinessCode.USER_PASSWORD_ERROR]: 400,
  [BusinessCode.USER_LOCKED]: 423,
  [BusinessCode.USER_ALREADY_EXISTS]: 409,
  [BusinessCode.INTERNAL_ERROR]: 500,
  [BusinessCode.DATABASE_ERROR]: 500,
  [BusinessCode.CACHE_ERROR]: 500,
  [BusinessCode.UPSTREAM_ERROR]: 502,
}
