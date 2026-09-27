/**
 * 审计事件订阅者
 *
 * C5 重构：**用户侧**业务不再直接调用 AuditService.log()，改为通过
 * EventEmitter 发出 `audit.log` 事件，本订阅者监听后异步落库。
 *
 * 好处：
 *  - 业务侧不再 import AuditService，降低耦合
 *  - 事件天然异步，不阻塞主业务（审计写入失败不会回滚业务事务）
 *  - 后续扩展（如发 Kafka / 接 ELK）只需新增订阅者
 *
 * ⚠️ 现状是**两条埋点路径并存**，不要以为审计全都走事件：
 *  - 用户侧（user 模块的 auth.service / user-crud.service）→ emit(AuditEvents.LOG)
 *  - 管理端（admin 下的 permission / role / user-role 三个 controller，共 11 处）
 *    → 直接 await auditService.log(...)，理由是需要「写成功才算操作成功」，
 *      不能接受异步丢审计。代价是同步写、失败即失败，与用户侧行为不同。
 * 排查「某操作没进审计表」时两条路径都要看。
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
