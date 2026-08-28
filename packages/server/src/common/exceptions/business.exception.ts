/**
 * 统一业务异常基类
 *
 * 用法：
 *   throw new BusinessException(BusinessCode.USER_NOT_FOUND, '用户不存在')
 *   throw new BusinessException(BusinessCode.PARAM_INVALID, '用户名不能为空', { field: 'username' })
 *
 * 全局 ExceptionFilter 会捕获并自动转成 { code, msg, data, requestId } 响应
 */

import { HttpException, HttpStatus } from '@nestjs/common'
import { BusinessCode, BusinessCodeToHttpStatus } from '../enums/business-code.enum'

export interface BusinessExceptionOptions {
  /** 业务码 */
  code: BusinessCode
  /** 用户可读的提示消息 */
  msg: string
  /** 扩展数据（前端不需要关注，仅用于调试） */
  data?: unknown
  /** 强制 HTTP 状态码（默认按 BusinessCode 映射） */
  httpStatus?: HttpStatus
}

export class BusinessException extends HttpException {
  public readonly businessCode: BusinessCode
  public readonly data: unknown

  constructor(code: BusinessCode, msg: string, data?: unknown)
  constructor(options: BusinessExceptionOptions)
  constructor(arg1: BusinessCode | BusinessExceptionOptions, msg?: string, data?: unknown) {
    // 支持两种调用风格
    const code = typeof arg1 === 'object' ? arg1.code : arg1
    const message = typeof arg1 === 'object' ? arg1.msg : (msg ?? '业务异常')
    const detail = typeof arg1 === 'object' ? arg1.data : data
    const httpStatus =
      typeof arg1 === 'object' && arg1.httpStatus
        ? arg1.httpStatus
        : (BusinessCodeToHttpStatus[code] ?? HttpStatus.INTERNAL_SERVER_ERROR)

    super({ code, message, data: detail ?? null }, httpStatus)
    this.businessCode = code
    this.data = detail ?? null
  }
}
