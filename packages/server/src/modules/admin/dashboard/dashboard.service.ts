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
 * Dashboard 统计 Service（C6 拆分 + P1-1 优化）
 *
 * 性能优化：
 *  - 原来 getOverview 用 Promise.all 并行 11 次 count() → 11 次 DB 往返
 *  - 现在合并为：
 *    * 5 个基础总数 → 单条 SQL UNION ALL（1 次往返）
 *    * 3 个时间窗口统计 → 单条 SQL UNION ALL（1 次往返）
 *    * 3 个状态过滤（active/inactive 来自 union 已覆盖的 user 表）→ 不重复
 *  - 总 DB 往返：11 → 2
 *
 * 架构原则：
 *  - Controller 只负责路由 + 参数转发
 *  - 所有聚合逻辑在本 Service
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

    // ========== P1-1 优化：UNION ALL 单查询取基础计数 ==========
    // 5 个独立 count → 1 次往返
    // 注意：表名按实体 @Entity() 声明（sys_user / sys_role / sys_permission / account_book / sys_file）
    const totals = await this.userRepo.manager.query(
      `SELECT 'user_total' AS k, COUNT(*) AS v FROM sys_user
       UNION ALL
       SELECT 'role_total', COUNT(*) FROM sys_role
       UNION ALL
       SELECT 'perm_total', COUNT(*) FROM sys_permission
       UNION ALL
       SELECT 'book_total', COUNT(*) FROM account_book
       UNION ALL
       SELECT 'file_total', COUNT(*) FROM sys_file`,
    ) as Array<{ k: string; v: string }>
    const totalMap = new Map(totals.map((r) => [r.k, Number(r.v)]))
    const userTotal = totalMap.get('user_total') ?? 0
    const roleTotal = totalMap.get('role_total') ?? 0
    const permTotal = totalMap.get('perm_total') ?? 0
    const bookTotal = totalMap.get('book_total') ?? 0
    const fileTotal = totalMap.get('file_total') ?? 0

    // 用户活跃/非活跃（单条 SQL 用 SUM 条件统计，避免 2 次 count）
    const userStatus = await this.userRepo.manager.query(
      `SELECT
         SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS inactive
       FROM sys_user`,
    ) as Array<{ active: string | null; inactive: string | null }>
    const userActive = Number(userStatus[0]?.active ?? 0)
    const userInactive = Number(userStatus[0]?.inactive ?? 0)

    // ========== P1-1 优化：UNION ALL 单查询取时间窗口统计 ==========
    // 4 个独立 count → 1 次往返
    const windowed = await this.userRepo.manager.query(
      `SELECT 'audit_total' AS k, COUNT(*) AS v FROM sys_audit_log
       UNION ALL
       SELECT 'new_users_24h', COUNT(*) FROM sys_user WHERE create_time >= ?
       UNION ALL
       SELECT 'audit_24h', COUNT(*) FROM sys_audit_log WHERE create_time >= ?
       UNION ALL
       SELECT 'failed_login_24h', COUNT(*) FROM sys_audit_log
         WHERE action = 'login' AND status = 0 AND create_time >= ?`,
      [now - oneDayMs, now - oneDayMs, now - oneDayMs],
    ) as Array<{ k: string; v: string }>
    const windowedMap = new Map(windowed.map((r) => [r.k, Number(r.v)]))
    const auditTotal = windowedMap.get('audit_total') ?? 0
    const newUsers24h = windowedMap.get('new_users_24h') ?? 0
    const auditLogs24h = windowedMap.get('audit_24h') ?? 0
    const failedLogin24h = windowedMap.get('failed_login_24h') ?? 0

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