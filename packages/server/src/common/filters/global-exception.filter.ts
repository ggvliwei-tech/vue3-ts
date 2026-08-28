/**
 * 全局异常过滤器（catch Everything）
 *
 * 统一响应格式：
 *   {
 *     code:      BusinessCode,
 *     msg:       string,         // 用户可读提示
 *     data:      unknown | null,
 *     requestId: string,         // 用于链路追踪
 *     timestamp: number,
 *   }
 *
 * 覆盖所有异常类型：
 *   - HttpException（含 NestJS 内置 + 自定义 BusinessException）
 *   - TypeORM QueryFailedError（数据库约束冲突等）
 *   - 其他未知 Error（兜底 500）
 *
 * 同时输出结构化日志，附带 requestId 方便关联
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { QueryFailedError } from 'typeorm'
import { BusinessCode } from '../enums/business-code.enum'
import { BusinessException } from '../exceptions/business.exception'

// 简易 requestId：从 header 透传 X-Request-Id，没有则生成
function getOrGenRequestId(req: Request): string {
  const incoming = req.headers['x-request-id']
  if (typeof incoming === 'string' && incoming.length > 0) return incoming
  // 用时间戳 + 随机数生成一个短 ID
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()
    const requestId = getOrGenRequestId(request)

    let businessCode: BusinessCode = BusinessCode.INTERNAL_ERROR
    let httpStatus = HttpStatus.INTERNAL_SERVER_ERROR
    let msg = '系统内部错误'
    let data: unknown = null

    // ========== 1. 自定义 BusinessException ==========
    if (exception instanceof BusinessException) {
      businessCode = exception.businessCode
      httpStatus = exception.getStatus()
      msg = exception.message
      data = exception.data
    }
    // ========== 2. NestJS 内置 HttpException ==========
    else if (exception instanceof HttpException) {
      httpStatus = exception.getStatus()
      const res = exception.getResponse()
      // 兼容多种 response 形态：string / { message, statusCode } / { code, message }
      if (typeof res === 'string') {
        msg = res
      } else if (res && typeof res === 'object') {
        const r = res as Record<string, unknown>
        msg = (r.message as string) ?? exception.message
        // 兼容 ValidationPipe 的 message 数组
        if (Array.isArray(r.message)) {
          msg = (r.message as string[]).join('; ')
          businessCode = BusinessCode.PARAM_INVALID
          httpStatus = HttpStatus.BAD_REQUEST
          data = { errors: r.message }
        } else if (typeof r.code === 'number') {
          // 已经是业务码
          businessCode = r.code as BusinessCode
        }
      }
    }
    // ========== 3. TypeORM 数据库错误 ==========
    else if (exception instanceof QueryFailedError) {
      businessCode = BusinessCode.DATABASE_ERROR
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR
      msg = '数据库操作失败'
      // 唯一约束冲突 → 友好提示
      const driverErr = (exception as any).driverError
      if (driverErr?.code === 'ER_DUP_ENTRY') {
        businessCode = BusinessCode.CONFLICT
        msg = '数据已存在，请勿重复提交'
      }
      this.logger.error(
        `[${requestId}] DB error: ${driverErr?.sqlMessage ?? exception.message}`,
      )
    }
    // ========== 4. 未知错误（兜底 500） ==========
    else {
      const err = exception as Error
      this.logger.error(
        `[${requestId}] Unhandled error on ${request.method} ${request.url}: ${err?.stack ?? exception}`,
      )
    }

    // 4xx 级别用 warn，5xx 用 error（避免日志噪音）
    if (httpStatus >= 500) {
      this.logger.error(`[${requestId}] ${httpStatus} ${msg}`)
    } else {
      this.logger.warn(`[${requestId}] ${httpStatus} ${msg}`)
    }

    // 设置响应头：方便客户端排查时透出 requestId
    response.setHeader('X-Request-Id', requestId)
    response.status(httpStatus).json({
      code: businessCode,
      msg,
      data,
      requestId,
      timestamp: Date.now(),
    })
  }
}
