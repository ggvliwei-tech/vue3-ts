/**
 * 审计事件订阅者
 *
 * C5 重构：AuditService.log() 不再被业务侧直接调用，业务侧通过
 * EventEmitter 发出 `audit.log` 事件，本订阅者监听后异步落库。
 *
 * 好处：
 *  - 业务侧不再 import AuditService，降低耦合
 *  - 事件天然异步，不阻塞主业务（审计写入失败不会回滚业务事务）
 *  - 后续扩展（如发 Kafka / 接 ELK）只需新增订阅者
 */
import { Injectable } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { AuditService } from './audit.service'
import { AuditEvents } from './audit.events'
import type { AuditLogPayload } from './audit.events'

@Injectable()
export class AuditSubscriber {
  constructor(private readonly auditService: AuditService) {}

  @OnEvent(AuditEvents.LOG, { async: true })
  async handleAuditLog(payload: AuditLogPayload): Promise<void> {
    await this.auditService.log(payload.action, payload.ctx)
  }
}
