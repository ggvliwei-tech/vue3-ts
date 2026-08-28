// NestJS 控制器与请求装饰器
import { Controller, Get, UseGuards } from '@nestjs/common'
// Swagger 装饰器
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
// JWT 认证守卫
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard'
// 权限守卫
import { PermissionsGuard } from '../../../common/guards/permissions.guard'
// 权限装饰器
import { Permissions } from '../../../common/decorators/permissions.decorator'
// 注入 TypeORM Repository
import { InjectRepository } from '@nestjs/typeorm'
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
 * 管理端 - 仪表盘统计
 *
 * 路由前缀：/admin/dashboard
 * 权限码：dashboard:view
 *
 * 提供管理后台首页所需的统计概览数据
 */
@ApiTags('管理端-仪表盘')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/dashboard')
export class DashboardController {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(RoleEntity) private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(PermissionEntity) private readonly permRepo: Repository<PermissionEntity>,
    @InjectRepository(AccountBookEntity) private readonly bookRepo: Repository<AccountBookEntity>,
    @InjectRepository(FileEntity) private readonly fileRepo: Repository<FileEntity>,
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
  ) {}

  @ApiOperation({ summary: '首页概览统计' })
  @Permissions('dashboard:view')
  @Get('overview')
  async overview() {
    const now = Date.now()
    const oneDayMs = 24 * 60 * 60 * 1000

    // 一次性查基础计数
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

    // 近 24h 新增用户
    const newUsers24h = await this.userRepo
      .createQueryBuilder('u')
      .where('u.createTime >= :t', { t: now - oneDayMs })
      .getCount()

    // 近 24h 审计日志
    const auditLogs24h = await this.auditRepo
      .createQueryBuilder('a')
      .where('a.createTime >= :t', { t: now - oneDayMs })
      .getCount()

    // 失败登录次数（近 24h）
    const failedLogin24h = await this.auditRepo
      .createQueryBuilder('a')
      .where("a.action = 'login'")
      .andWhere('a.status = 0')
      .andWhere('a.createTime >= :t', { t: now - oneDayMs })
      .getCount()

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

  @ApiOperation({ summary: '近 7 天每天的新增用户数（趋势）' })
  @Permissions('dashboard:view')
  @Get('user-trend')
  async userTrend() {
    const days = 7
    const now = Date.now()
    const oneDayMs = 24 * 60 * 60 * 1000
    const result: { date: string; count: number }[] = []

    for (let i = days - 1; i >= 0; i--) {
      const start = now - (i + 1) * oneDayMs
      const end = now - i * oneDayMs
      const count = await this.userRepo
        .createQueryBuilder('u')
        .where('u.createTime >= :s AND u.createTime < :e', { s: start, e: end })
        .getCount()
      const d = new Date(start)
      const date = `${d.getMonth() + 1}/${d.getDate()}`
      result.push({ date, count })
    }
    return result
  }

  @ApiOperation({ summary: '近 7 天审计日志动作分布（TOP10）' })
  @Permissions('dashboard:view')
  @Get('audit-top')
  async auditTop() {
    const days = 7
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
