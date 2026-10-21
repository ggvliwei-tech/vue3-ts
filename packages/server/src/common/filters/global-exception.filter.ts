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
    // WebSocket 上下文（chat.gateway 的 @SubscribeMessage）没有 HTTP 的 req / res。
    // 不做这个分流的话，下面第一行 getOrGenRequestId(request) 会去读
    // request.headers —— WS 上下文里 getRequest() 给到的是 socket 本身，
    // 它没有 headers 属性，于是取属性即抛 TypeError。
    // 过滤器自己再抛异常，等于异常处理链路整体失效：客户端拿不到任何错误码，
    // 服务端只剩一条 init 阶段的噪音日志。必须在这里就分出去。
    if (host.getType() !== 'http') {
      this.handleWsException(exception, host)
      return
    }

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
          businessCode = r.code
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
        // httpStatus 也必须跟着改：确认冲突是**客户端**的问题（重复提交），
        // 不是服务端故障。留在 500 的代价是监控里一堆假 500 —— 告警阈值、
        // 错误率看板、按状态码分流的日志采集全都被这条噪音污染，
        // 而真正需要人看的 500 会被淹掉。前端解析的也是 msg，不受影响。
        httpStatus = HttpStatus.CONFLICT
        msg = '数据已存在，请勿重复提交'
      } else {
        // 非唯一约束的 DB 错误在生产只给通用文案（避免泄漏表名/SQL），
        // 本地开发把驱动层原因带上 —— 否则页面只显示「系统内部错误」，
        // 分不清是连不上 MySQL、表结构漂移还是 SQL 写错了。
        msg = this.withDevDetail(msg, driverErr?.sqlMessage ?? exception.message)
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
      // 生产环境保持「系统内部错误」通用文案（错误详情只进日志，防止泄漏内部实现）；
      // 非生产把真实 message 带给前端，本地调试时一眼能看出是 ECONNREFUSED、
      // 环境变量缺失还是代码 TypeError，不必再去翻日志。
      msg = this.withDevDetail(msg, err?.message ?? String(exception))
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

  /**
   * 非生产环境在通用文案后追加真实错误信息。
   *
   * 生产环境（NODE_ENV=production）原样返回，500 响应里仍只有「系统内部错误」，
   * 详细信息靠 requestId 去日志里查 —— 这是对外接口的既定约定，不要放宽。
   */
  private withDevDetail(msg: string, detail: unknown): string {
    if (process.env.NODE_ENV === 'production') return msg
    const text = typeof detail === 'string' ? detail.trim() : ''
    return text ? `${msg}（${text}）` : msg
  }

  /**
   * WebSocket 上下文下的异常出口。
   *
   * 没有 HTTP 响应可写，改为向该 socket 推一条 `error` 事件 ——
   * 与 chat.gateway 里手工 client.emit('error', { code, msg }) 的形状保持一致，
   * 前端（ChatRoom.vue 的 onError）不必区分错误来自哪里。
   *
   * 拿不到 client 时只记日志：宁可少推一条事件，也不能在过滤器里再抛异常。
   */
  private handleWsException(exception: unknown, host: ArgumentsHost): void {
    let code = Number(HttpStatus.INTERNAL_SERVER_ERROR)
    let msg = '系统内部错误'

    if (exception instanceof HttpException) {
      code = exception.getStatus()
      const res = exception.getResponse()
      if (typeof res === 'string') {
        msg = res
      } else if (res && typeof res === 'object') {
        const r = res as Record<string, unknown>
        // ValidationPipe 抛的是 { message: string[] }，拼成一行才可读
        msg = Array.isArray(r.message)
          ? (r.message as string[]).join('; ')
          : ((r.message as string) ?? exception.message)
      }
    } else {
      // 与 HTTP 出口保持一致：非生产把未知错误的真实原因推给客户端
      msg = this.withDevDetail(msg, (exception as Error)?.message ?? String(exception))
    }

    this.logger.error(
      `[WS] ${code} ${msg} —— ${(exception as Error)?.stack ?? String(exception)}`,
    )

    try {
      const client = host.switchToWs().getClient<{ emit?: (ev: string, data: unknown) => void }>()
      client?.emit?.('error', { code, msg })
    } catch (emitErr) {
      this.logger.error(`[WS] 推送错误事件失败: ${(emitErr as Error).message}`)
    }
  }
}
