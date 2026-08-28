// 注入装饰器
import { Injectable } from '@nestjs/common'
// 注入 TypeORM Repository
import { InjectRepository } from '@nestjs/typeorm'
// TypeORM Repository
import { Repository } from 'typeorm'
// 用户实体
import { User } from '../../user/entities/user.entity'
// 角色实体
import { RoleEntity } from '../../rbac/entities/role.entity'
// 权限实体
import { PermissionEntity } from '../../rbac/entities/permission.entity'
// 账本实体
import { AccountBookEntity } from '../../account_book/entities/account-book.entity'
// 文件实体
import { FileEntity } from '../../file/entities/file.entity'
// 审计实体
import { AuditLog } from '../../audit/entities/audit-log.entity'

/**
 * Dashboard 统计 Service（C6 拆分）
 *
 * 之前所有 QueryBuilder / count 逻辑直接写在 Controller，
 * 违反"Controller 只负责路由 + 参数转发"的架构原则。
 * 本类承担全部数据聚合逻辑。
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(RoleEntity) private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(PermissionEntity) private readonly permRepo: Repository<PermissionEntity>,
    @InjectRepository(AccountBookEntity) private readonly bookRepo: Repository<AccountBookEntity>,
    @InjectRepository(FileEntity) private readonly fileRepo: Repository<FileEntity>,
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
  ) {}

  /** 仪表盘首页概览 */
  async getOverview() {
    const now = Date.now()
    const oneDayMs = 24 * 60 * 60 * 1000

    // 一次性查基础计数（并行）
    const [userTotal, userActive, userInactive, roleTotal, permTotal, bookTotal, fileTotal, auditTotal] =
      await Promise.all([
        this.userRepo.count(),
        this.userRepo.count({ where: { status: 1 } }),
        this.userRepo.count({ where: { status: 0 } }),
        this.roleRepo.count(),
        this.permRepo.count(),
        this.bookRepo.count(),
        this.fileRepo.count(),
        this.auditRepo.count(),
      ])

    // 近 24h 指标（并行）
    const [newUsers24h, auditLogs24h, failedLogin24h] = await Promise.all([
      this.userRepo
        .createQueryBuilder('u')
        .where('u.createTime >= :t', { t: now - oneDayMs })
        .getCount(),
      this.auditRepo
        .createQueryBuilder('a')
        .where('a.createTime >= :t', { t: now - oneDayMs })
        .getCount(),
      this.auditRepo
        .createQueryBuilder('a')
        .where("a.action = 'login'")
        .andWhere('a.status = 0')
        .andWhere('a.createTime >= :t', { t: now - oneDayMs })
        .getCount(),
    ])

    return {
      user: { total: userTotal, active: userActive, inactive: userInactive, new24h: newUsers24h },
      role: { total: roleTotal },
      permission: { total: permTotal },
      accountBook: { total: bookTotal },
      file: { total: fileTotal },
      audit: { total: auditTotal, last24h: auditLogs24h, failedLogin24h },
      timestamp: now,
    }
  }

  /**
   * 近 N 天每天的新增用户数（趋势）
   * 用一条 GROUP BY 查询替代 N 次循环 count，避免 N 次往返
   */
  async getUserTrend(days = 7): Promise<{ date: string; count: number }[]> {
    const oneDayMs = 24 * 60 * 60 * 1000
    const now = Date.now()
    const since = now - days * oneDayMs

    // 用 FLOOR(createTime / oneDayMs) 把毫秒时间戳归桶到"距今天数"
    // 再按桶分组计数，最后在 JS 端补全缺失日期为 0
    const rows = await this.userRepo
      .createQueryBuilder('u')
      .select(`FLOOR((:now - u.createTime) / :oneDay)`, 'daysAgo')
      .addSelect('COUNT(*)', 'count')
      .where('u.createTime >= :since', { now, oneDay: oneDayMs, since })
      .groupBy('daysAgo')
      .getRawMany<{ daysAgo: string; count: string }>()

    // 索引化：daysAgo -> count
    const bucket = new Map<number, number>()
    for (const r of rows) {
      bucket.set(Number(r.daysAgo), Number(r.count))
    }

    // 按日期顺序补全
    const result: { date: string; count: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const start = now - (i + 1) * oneDayMs
      const d = new Date(start)
      const date = `${d.getMonth() + 1}/${d.getDate()}`
      // daysAgo 是"距 now 的天数"（向下取整），i 是循环里的"天数索引"
      result.push({ date, count: bucket.get(i) ?? 0 })
    }
    return result
  }

  /** 近 N 天审计日志动作分布（TOP10） */
  async getAuditTop(days = 7): Promise<{ action: string; count: number }[]> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000
    const rows = await this.auditRepo
      .createQueryBuilder('a')
      .select('a.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .where('a.createTime >= :t', { t: since })
      .groupBy('a.action')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany<{ action: string; count: string }>()
    return rows.map((r) => ({ action: r.action, count: Number(r.count) }))
  }
}