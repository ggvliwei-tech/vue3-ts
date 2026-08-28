// 注入装饰器
import { Inject, Injectable } from '@nestjs/common'
// nest-winston 提供的 Logger
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston'
import { Logger as WinstonLogger } from 'winston'
// 注入 Repository 装饰器
import { InjectRepository } from '@nestjs/typeorm'
// TypeORM Repository
import { Repository } from 'typeorm'
// 审计日志实体
import { AuditLog } from './entities/audit-log.entity'

/**
 * 审计日志上下文（写入时由调用方组装）
 */
export interface AuditContext {
  // 用户 ID（未登录场景可省略）
  userId?: number
  // 用户名（冗余存储）
  username?: string
  // 客户端 IP
  ip?: string
  // User-Agent
  userAgent?: string
  // 操作对象类型
  resource?: string
  // 操作对象 ID
  resourceId?: string | number
  // 状态：1 成功 / 0 失败
  status: 0 | 1
  // 扩展详情（任意 JSON）
  detail?: Record<string, any>
}

/**
 * 审计日志服务
 *
 * 职责：
 *  - 异步记录关键操作日志到 MySQL
 *  - 提供分页查询接口（仅 admin 角色可访问）
 *
 * 设计：
 *  - 不阻塞主流程：写入失败仅打日志，不抛异常（避免日志系统故障影响业务）
 *  - detail 字段存 JSON，保留扩展性
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: WinstonLogger,
  ) {}

  /**
   * 记录一条审计日志（异步失败不抛异常）
   * @param action 动作编码：login/logout/refresh/kick/toggle-status/reset-password
   * @param ctx 上下文信息
   */
  async log(action: string, ctx: AuditContext): Promise<void> {
    try {
      // 创建实体实例
      const entry = this.auditRepo.create({
        action,
        userId: ctx.userId ?? null,
        username: ctx.username ?? null,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        resource: ctx.resource ?? null,
        resourceId:
          ctx.resourceId !== undefined && ctx.resourceId !== null
            ? String(ctx.resourceId)
            : null,
        status: ctx.status,
        detail: ctx.detail ?? null,
        createTime: Date.now(),
      })
      await this.auditRepo.save(entry)
    } catch (err) {
      // 写入失败仅打日志，不影响主业务
      // 用 winston 写入 error-{date}.log，便于告警系统采集
      this.logger.error(`[Audit] 写入审计日志失败: ${(err as Error).message}`, {
        action,
        userId: ctx.userId,
      })
    }
  }

  /**
   * 分页查询审计日志
   * @param page 页码（从 1 开始）
   * @param pageSize 每页条数
   * @param filters 可选过滤条件
   */
  async findAll(
    page = 1,
    pageSize = 20,
    filters?: {
      action?: string
      userId?: number
      username?: string
      status?: 0 | 1
      startTime?: number
      endTime?: number
    },
  ): Promise<{ list: AuditLog[]; total: number; page: number; pageSize: number }> {
    // 用 QueryBuilder 拼装过滤条件
    const qb = this.auditRepo.createQueryBuilder('log')

    if (filters?.action) {
      qb.andWhere('log.action = :action', { action: filters.action })
    }
    if (filters?.userId) {
      qb.andWhere('log.user_id = :userId', { userId: filters.userId })
    }
    if (filters?.username) {
      // 用前缀匹配（username%）使索引可用；%username% 会全表扫描
      qb.andWhere('log.username LIKE :username', {
        username: `${filters.username}%`,
      })
    }
    if (filters?.status !== undefined) {
      qb.andWhere('log.status = :status', { status: filters.status })
    }
    if (filters?.startTime) {
      qb.andWhere('log.createTime >= :startTime', { startTime: filters.startTime })
    }
    if (filters?.endTime) {
      qb.andWhere('log.createTime <= :endTime', { endTime: filters.endTime })
    }

    // 按时间倒序
    qb.orderBy('log.createTime', 'DESC')
    // 分页
    qb.skip((page - 1) * pageSize).take(pageSize)

    const [list, total] = await qb.getManyAndCount()
    return { list, total, page, pageSize }
  }
}
