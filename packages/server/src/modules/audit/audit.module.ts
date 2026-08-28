// NestJS 模块装饰器
import { Module } from '@nestjs/common'
// TypeORM 模块
import { TypeOrmModule } from '@nestjs/typeorm'
// 审计日志实体
import { AuditLog } from './entities/audit-log.entity'
// 审计服务
import { AuditService } from './audit.service'
// 审计控制器
import { AuditController } from './audit.controller'
// 审计事件订阅者（C5：解耦业务与审计）
import { AuditSubscriber } from './audit.subscriber'
// 审计日志定期清理（M9）
import { AuditCleanupCron } from './audit-cleanup.cron'

/**
 * 审计日志模块：负责记录与查询关键操作日志
 *
 * C5 重构后，业务侧通过 EventEmitter 发 `audit.log` 事件，
 * AuditSubscriber 监听后调用 AuditService.log() 落库。
 *
 * M9 增加 AuditCleanupCron，每天凌晨清理过期日志。
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditController],
  providers: [AuditService, AuditSubscriber, AuditCleanupCron],
  exports: [AuditService, AuditSubscriber],
})
export class AuditModule {}
