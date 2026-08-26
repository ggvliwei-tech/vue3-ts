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

/**
 * 审计日志模块：负责记录与查询关键操作日志
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditController],
  providers: [AuditService],
  // 导出供 user.service / chat.gateway 等模块埋点使用
  exports: [AuditService],
})
export class AuditModule {}
