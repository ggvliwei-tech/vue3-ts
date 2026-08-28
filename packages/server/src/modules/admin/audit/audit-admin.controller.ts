// NestJS 控制器与请求装饰器
import { Controller, Get, Query, UseGuards } from '@nestjs/common'
// Swagger 装饰器
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
// JWT 认证守卫
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard'
// 权限守卫
import { PermissionsGuard } from '../../../common/guards/permissions.guard'
// 权限装饰器
import { Permissions } from '../../../common/decorators/permissions.decorator'
// 审计服务
import { AuditService } from '../../audit/audit.service'

/**
 * 管理端 - 审计日志
 *
 * 路由前缀：/admin/audit
 * 权限码：admin:audit（独立权限码，与 user:audit 区分）
 *
 * 与 /audit 控制器功能相同，仅路由前缀不同，供前端管理后台统一管理
 */
@ApiTags('管理端-审计日志')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/audit')
export class AuditAdminController {
  constructor(private readonly auditService: AuditService) {}

  @ApiOperation({ summary: '分页查询审计日志' })
  @Permissions('admin:audit')
  @Get('logs')
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('username') username?: string,
    @Query('status') status?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ) {
    const _page = Math.max(1, Number(page) || 1)
    const _pageSize = Math.min(100, Math.max(1, Number(pageSize) || 20))
    return this.auditService.findAll(_page, _pageSize, {
      action,
      userId: userId ? Number(userId) : undefined,
      username,
      status: status !== undefined ? (Number(status) as 0 | 1) : undefined,
      startTime: startTime ? Number(startTime) : undefined,
      endTime: endTime ? Number(endTime) : undefined,
    })
  }

  @ApiOperation({ summary: '审计动作枚举（用于查询面板下拉）' })
  @Permissions('admin:audit')
  @Get('actions')
  actions() {
    // 常用审计动作码，供前端筛选下拉
    return [
      'login', 'logout', 'refresh',
      'kick', 'toggle-status', 'reset-password',
      'role:create', 'role:update', 'role:delete', 'role:assign-permission',
      'permission:create', 'permission:update', 'permission:delete',
      'user-role:assign', 'user-role:add', 'user-role:remove',
    ]
  }
}
