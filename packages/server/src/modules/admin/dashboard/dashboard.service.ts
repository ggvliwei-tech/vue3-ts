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

/** 一天的毫秒数 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000
/**
 * 趋势图按东八区日历日切桶。
 * 与 MySQL 的 --default-time-zone=+08:00（见 docker-compose.yml）以及
 * SmsService 的日配额口径保持一致 —— 同一个系统里"一天从几点开始"
 * 只能有一个答案。中国自 1991 年起不再实行夏令时，UTC+8 是固定偏移，
 * 因此可以用常量而不是时区数据库。
 */
const TREND_TZ_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * Dashboard 统计 Service
 *
 * 性能优化：
 *  - 原来 getOverview 用 Promise.all 并行 11 次 count() → 11 次 DB 往返
 *  - 现在合并为：
 *    * 5 个基础总数 → 单条 SQL UNION ALL（1 次往返）
 *    * 4 个时间窗口统计 → 单条 SQL UNION ALL（1 次往返）
 *    * active/inactive 状态过滤 → 单条 SUM(CASE WHEN) 查询（1 次往返）
 *  - 总 DB 往返：11 → 3
 *
 * 列名注意：本文件用原生 SQL，必须写**实体里实际的列名**，不能靠命名习惯猜。
 * 本项目**没有**开 SnakeNamingStrategy（app.module.ts），所以列名默认等于实体属性名，
 * 但部分实体用 `@Column({ name: '...' })` 显式改成了下划线命名，两类混用：
 *  - 驼峰：sys_user / account_book / sys_file / chat_* 等（createTime、userId、creatorId）
 *  - 下划线：sys_audit_log（user_id / resource_id / user_agent）、
 *            ai_session、ai_message（user_id / session_id / created_at / updated_at）、
 *            sys_user_role、sys_role_permission（user_id / role_id / permission_id）
 * 更麻烦的是同表内混用：sys_audit_log 的 createTime 是驼峰，user_id 却是下划线。
 * 写原生 SQL 前对照 nest-db.sql 或实体上的 name 值（audit.service.ts 写 `log.user_id` 就是这原因）。
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

    // ========== UNION ALL 单查询取基础计数 ==========
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
    )
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
    )
    const userActive = Number(userStatus[0]?.active ?? 0)
    const userInactive = Number(userStatus[0]?.inactive ?? 0)

    // ========== UNION ALL 单查询取时间窗口统计 ==========
    // 4 个独立 count → 1 次往返
    const windowed = await this.userRepo.manager.query(
      `SELECT 'audit_total' AS k, COUNT(*) AS v FROM sys_audit_log
       UNION ALL
       SELECT 'new_users_24h', COUNT(*) FROM sys_user WHERE createTime >= ?
       UNION ALL
       SELECT 'audit_24h', COUNT(*) FROM sys_audit_log WHERE createTime >= ?
       UNION ALL
       SELECT 'failed_login_24h', COUNT(*) FROM sys_audit_log
         WHERE action = 'login' AND status = 0 AND createTime >= ?`,
      [now - oneDayMs, now - oneDayMs, now - oneDayMs],
    )
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
   *
   * ⚠️ 桶与标签必须由**同一个时间戳**推出，且都以本地日历日为准。
   * 此前的实现是「按滚动 24 小时切桶（now - createTime），却用
   * new Date(now - (i+1)*一天) 的日历日期当标签」，两者错开一整天：
   * 今天上午 9 点注册的用户落在 i=0 那个桶里，而该桶的标签是**昨天**的日期，
   * 图表上表现为"今天的注册量显示在昨天那一列"，且随着 now 推进，
   * 同一批数据会整天在图上缓慢左移（每次刷新都不同）。
   */
  async getUserTrend(days = 7): Promise<{ date: string; count: number }[]> {
    const now = Date.now()
    // 东八区「今天」的零点（用 epoch 毫秒表示）
    const todayStart =
      Math.floor((now + TREND_TZ_OFFSET_MS) / ONE_DAY_MS) * ONE_DAY_MS -
      TREND_TZ_OFFSET_MS
    const since = todayStart - (days - 1) * ONE_DAY_MS

    // 平移到东八区后按整日归桶，得到"日历日序号"（整数）
    const rows = await this.userRepo
      .createQueryBuilder('u')
      .select(`FLOOR((u.createTime + :offset) / :oneDay)`, 'dayIndex')
      .addSelect('COUNT(*)', 'count')
      .where('u.createTime >= :since', {
        offset: TREND_TZ_OFFSET_MS,
        oneDay: ONE_DAY_MS,
        since,
      })
      .groupBy('dayIndex')
      .getRawMany<{ dayIndex: string; count: string }>()

    // 索引化：日历日序号 -> count
    const bucket = new Map<number, number>()
    for (const r of rows) {
      bucket.set(Number(r.dayIndex), Number(r.count))
    }

    // 按日期顺序补全缺失日期为 0
    const result: { date: string; count: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const dayStart = todayStart - i * ONE_DAY_MS
      // 用平移后的时间戳取 UTC 年月日 == 东八区日历日，
      // 这样标签与桶序号由同一个 dayStart 推出，天然对齐，
      // 也不受服务器进程时区（容器默认 UTC）影响。
      const shifted = dayStart + TREND_TZ_OFFSET_MS
      const d = new Date(shifted)
      const date = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
      result.push({
        date,
        count: bucket.get(Math.floor(shifted / ONE_DAY_MS)) ?? 0,
      })
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