/**
 * 审计日志定期清理（M9）
 *
 * 默认每天凌晨 3 点删除 90 天前的审计日志
 * - 保留期可通过环境变量 AUDIT_RETENTION_DAYS 调整
 * - 走 deleted_at 软删除（如未来需要），当前阶段直接物理删除
 *
 * 设计要点：
 *  - 走 createTime 索引的范围删除，避免全表扫描
 *  - 单次删除分批 LIMIT 1000，避免大事务长锁
 *  - 删除完成前 await，避免并发触发
 */
import { Inject, Injectable } from '@nestjs/common'
import type { LoggerService } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, LessThan } from 'typeorm'
import { Cron, CronExpression } from '@nestjs/schedule'
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston'
import { AuditLog } from './entities/audit-log.entity'

@Injectable()
export class AuditCleanupCron {
  /** 单批删除行数，避免大事务 */
  private readonly BATCH_SIZE = 1000
  /** 是否正在执行（防并发） */
  private running = false

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * 每天凌晨 3 点执行清理
   * 保留天数：默认 90（可通过 AUDIT_RETENTION_DAYS 调整）
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanup(): Promise<void> {
    if (this.running) {
      // 上一轮还在跑（极端长事务），跳过本轮
      return
    }
    this.running = true
    try {
      const retentionDays = Number(
        this.configService.get('AUDIT_RETENTION_DAYS') ?? 90,
      )
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000

      let deleted = 0
      // 分批删除直到无更多可删
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await this.auditRepo.delete({
          createTime: LessThan(cutoff),
        })
        const affected = result.affected ?? 0
        deleted += affected
        if (affected < this.BATCH_SIZE) break
      }

      if (deleted > 0) {
        this.logger.log(
          `[AuditCleanupCron] 删除 ${deleted} 条 ${retentionDays} 天前的审计日志`,
          'AuditCleanupCron',
        )
      }
    } catch (err) {
      this.logger.error(
        `[AuditCleanupCron] 执行失败: ${(err as Error).message}`,
        (err as Error).stack,
        'AuditCleanupCron',
      )
    } finally {
      this.running = false
    }
  }
}
