// NestJS 装饰器
import { Controller, Get, Query, UseGuards } from '@nestjs/common'
// Swagger 装饰器
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
// JWT 认证守卫
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
// 权限守卫
import { PermissionsGuard } from '../../common/guards/permissions.guard'
// 权限装饰器
import { Permissions } from '../../common/decorators/permissions.decorator'
// 审计服务
import { AuditService } from './audit.service'

// Swagger 分组标签
@ApiTags('审计日志')
// 控制器路由前缀
@Controller('audit')
// 挂载双守卫：JWT 认证 + 权限校验
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // 查询审计日志：仅 admin 角色可访问（user:audit 权限码）
  @ApiOperation({ summary: '分页查询审计日志（需要 user:audit 权限）' })
  @ApiBearerAuth()
  @Permissions('user:audit')
  @Get('logs')
  async list(
    // 分页参数
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    // 过滤参数
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('username') username?: string,
    @Query('status') status?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ) {
    // 默认 page=1, pageSize=20
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
}
