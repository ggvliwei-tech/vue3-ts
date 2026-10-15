/**
 * 审计日志定期清理
 *
 * 默认每天凌晨 3 点删除 90 天前的审计日志
 * - 保留期可通过环境变量 AUDIT_RETENTION_DAYS 调整
 * - 走 deleted_at 软删除（如未来需要），当前阶段直接物理删除
 *
 * 设计要点：
 *  - 走 createTime 索引的范围删除，避免全表扫描
 *  - 每批最多 BATCH_SIZE 行：先用 take 取一批主键，再按主键删除。
 *    注意 **不能** 直接 `repo.delete({ createTime: LessThan(cutoff) })` ——
 *    Repository.delete(criteria) 不支持 LIMIT，一条语句会删光全部匹配行，
 *    存量大的库上会撑出超长事务与长时间行锁。
 *  - 用 Redis SETNX 抢锁，而不是进程内布尔量：
 *    `@Cron` 会在**每个实例**上各注册一份，进程内标志在多副本部署时形同虚设，
 *    所有实例会在同一时刻并发跑同一批删除。
 *  - 删除完成前 await，避免并发触发
 */
import { Inject, Injectable } from '@nestjs/common'
import type { LoggerService } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, LessThan, In } from 'typeorm'
import { Cron, CronExpression } from '@nestjs/schedule'
import { randomUUID } from 'crypto'
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston'
import { AuditLog } from './entities/audit-log.entity'
import { RedisService } from '../redis/redis.service'

/** 默认保留天数 */
const DEFAULT_RETENTION_DAYS = 90
/** 合理保留期下限：低于 1 天等于「把审计日志删光」 */
const MIN_RETENTION_DAYS = 1
/** 分布式锁 key（RedisModule 是 @Global，RedisService 可直接注入） */
const LOCK_KEY = 'cron:audit-cleanup:lock'
/**
 * 锁的过期时间（秒）。
 * 取得偏长是为了覆盖一次完整清理（分批删除 + 行锁），同时保证进程被 kill 后
 * 锁能自动释放而不必人工干预。若单次清理真的超过这个时长，理论上可能有第二个
 * 实例进入 —— 但那时两者都是按主键删除，结果是幂等的（见下方注释），
 * 不会删错数据。
 */
const LOCK_TTL_SECONDS = 600

@Injectable()
export class AuditCleanupCron {
  /** 单批删除行数上限，避免大事务 */
  private readonly BATCH_SIZE = 1000

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * 解析保留天数。
   *
   * 不能简单地写 `Number(env ?? 90)`：那只兜住了 undefined。
   *   Number('')  === 0   → cutoff = Date.now() → 命中**每一行**历史，全部删光
   *   Number('-1') === -1 → cutoff 在未来，同样删光
   *   Number('abc') === NaN → cutoff 为 NaN，比较恒为 false，清理静默失效
   * 前两种会不可逆地销毁安全事件的唯一证据，所以非法值一律回退默认值并告警。
   */
  private resolveRetentionDays(): number {
    const raw = this.configService.get<string>('AUDIT_RETENTION_DAYS')
    // 未配置：静默使用默认值（正常情况，不必告警）
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return DEFAULT_RETENTION_DAYS
    }
    const parsed = parseInt(String(raw), 10)
    if (!Number.isFinite(parsed) || parsed < MIN_RETENTION_DAYS) {
      this.logger.warn(
        `[AuditCleanupCron] AUDIT_RETENTION_DAYS="${raw}" 不是有效天数，` +
          `已回退为 ${DEFAULT_RETENTION_DAYS} 天（合法值需为 ≥ ${MIN_RETENTION_DAYS} 的整数）`,
        'AuditCleanupCron',
      )
      return DEFAULT_RETENTION_DAYS
    }
    return parsed
  }

  /**
   * 每天凌晨 3 点执行清理
   * 保留天数：默认 90（可通过 AUDIT_RETENTION_DAYS 调整）
   *
   * 公开方法便于单测直接调用，绕开 cron 调度。
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanup(): Promise<void> {
    // 锁值用随机 token 标识"本次执行"，释放时据此判断锁是否还是自己的
    const lockToken = randomUUID()
    // 抢锁失败说明已有实例在跑（或上一轮的锁尚未过期），直接跳过本轮
    const acquired = await this.redisService.setnx(
      LOCK_KEY,
      lockToken,
      LOCK_TTL_SECONDS,
    )
    if (acquired !== 1) {
      this.logger.log(
        '[AuditCleanupCron] 已有实例在执行清理，跳过本轮',
        'AuditCleanupCron',
      )
      return
    }

    try {
      const retentionDays = this.resolveRetentionDays()
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000

      let deleted = 0
      // 分批删除直到无更多可删
      while (true) {
        // 第一批：只取主键，带上 take 才是真正的「LIMIT」
        const batch = await this.auditRepo.find({
          select: { id: true },
          where: { createTime: LessThan(cutoff) },
          order: { createTime: 'ASC' },
          take: this.BATCH_SIZE,
        })
        if (batch.length === 0) break

        // 第二批：按主键删除，影响行数严格等于本批大小
        await this.auditRepo.delete({ id: In(batch.map((r) => r.id)) })
        deleted += batch.length
        if (batch.length < this.BATCH_SIZE) break
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
      // 主动释放锁：若不释放，运维在 3 点后手工触发一次会被白等到锁过期。
      //
      // 必须先确认锁还是自己的那一把再删：若本次清理超过了 LOCK_TTL_SECONDS，
      // 锁已自动过期且可能被另一个实例抢走，此时无条件 del 会把**别人的**锁删掉，
      // 于是第三个实例又能进来 —— 锁就失去了意义。
      //
      // 已知局限：get 与 del 不是原子的（Redis 没有提供原子的"比较并删除"，
      // 需要 Lua 脚本）。这里的竞态窗口是微秒级，而它防护的问题（误删他人锁）
      // 需要"清理超时 + 恰好在此刻被抢锁 + 恰好在此刻走到 finally"三者同时发生。
      // 退一步说，即便真的发生，本任务的删除是按主键做的、幂等，不会删错数据。
      try {
        const current = await this.redisService.get(LOCK_KEY)
        if (current === lockToken) {
          await this.redisService.del(LOCK_KEY)
        }
      } catch (err) {
        // 释放失败不影响结果 —— 锁有 TTL，最坏情况是等它自然过期
        this.logger.warn(
          `[AuditCleanupCron] 释放锁失败: ${(err as Error).message}`,
          'AuditCleanupCron',
        )
      }
    }
  }
}
