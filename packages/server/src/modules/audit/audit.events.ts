/**
 * 审计相关事件常量
 *
 * C5 重构：引入 @nestjs/event-emitter 解耦业务服务与审计服务。
 * 业务侧 emit `audit.log` 事件，AuditSubscriber 监听并落库，
 * 业务侧不再直接注入 AuditService。
 *
 * 用法：
 *   this.events.emit(AuditEvents.LOG, { action: 'login', ctx: {...} })
 */
export const AuditEvents = {
  /** 通用审计日志事件 */
  LOG: 'audit.log',
} as const

/** AuditEvents.LOG 事件 payload 类型 */
export interface AuditLogPayload {
  action: string
  ctx: {
    userId?: number
    username?: string
    ip?: string
    userAgent?: string
    resource?: string
    resourceId?: string | number
    status: 0 | 1
    detail?: Record<string, any>
  }
}
