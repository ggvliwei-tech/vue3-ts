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
// Dashboard Service（C6 拆分后由 Service 承担全部查询逻辑）
import { DashboardService } from './dashboard.service'

/**
 * 管理端 - 仪表盘统计
 *
 * 路由前缀：/admin/dashboard
 * 权限码：dashboard:view
 *
 * Controller 只负责路由 + 权限校验，所有数据查询已下沉到 DashboardService
 */
@ApiTags('管理端-仪表盘')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @ApiOperation({ summary: '首页概览统计' })
  @Permissions('dashboard:view')
  @Get('overview')
  async overview() {
    return this.dashboardService.getOverview()
  }

  @ApiOperation({ summary: '近 7 天每天的新增用户数（趋势）' })
  @Permissions('dashboard:view')
  @Get('user-trend')
  async userTrend() {
    return this.dashboardService.getUserTrend()
  }

  @ApiOperation({ summary: '近 7 天审计日志动作分布（TOP10）' })
  @Permissions('dashboard:view')
  @Get('audit-top')
  async auditTop() {
    return this.dashboardService.getAuditTop()
  }
}