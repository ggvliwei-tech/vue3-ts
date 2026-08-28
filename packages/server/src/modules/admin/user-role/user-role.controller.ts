// NestJS 控制器与请求装饰器
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common'
// Swagger 装饰器
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
// JWT 认证守卫
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard'
// 权限守卫
import { PermissionsGuard } from '../../../common/guards/permissions.guard'
// 权限装饰器
import { Permissions } from '../../../common/decorators/permissions.decorator'
// 当前用户装饰器
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
// 服务
import { UserRoleService } from './user-role.service'
// DTO
import { AssignRolesDto } from './dto/assign-role.dto'
// 审计服务
import { AuditService } from '../../audit/audit.service'

/**
 * 管理端 - 用户角色分配
 *
 * 路由前缀：/admin/user-role
 * 权限码：user-role:list / user-role:assign / user-role:remove
 */
@ApiTags('管理端-用户角色分配')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/user-role')
export class UserRoleController {
  constructor(
    private readonly userRoleService: UserRoleService,
    private readonly auditService: AuditService,
  ) {}

  @ApiOperation({ summary: '查询用户的角色列表' })
  @Permissions('user-role:list')
  @Get('user/:userId')
  getUserRoles(@Param('userId') userId: string) {
    return this.userRoleService.getUserRoles(Number(userId))
  }

  @ApiOperation({ summary: '查询角色下的用户列表' })
  @Permissions('user-role:list')
  @Get('role/:roleId/users')
  getRoleUsers(
    @Param('roleId') roleId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const _page = Math.max(1, Number(page) || 1)
    const _pageSize = Math.min(100, Math.max(1, Number(pageSize) || 20))
    return this.userRoleService.getRoleUsers(Number(roleId), _page, _pageSize)
  }

  @ApiOperation({ summary: '给用户分配角色（全量替换）' })
  @Permissions('user-role:assign')
  @Put('user/:userId')
  async assign(@Param('userId') userId: string, @Body() dto: AssignRolesDto, @CurrentUser() user: any) {
    await this.userRoleService.assignRoles(Number(userId), dto.roleIds)
    await this.auditService.log('user-role:assign', {
      userId: user.id,
      username: user.username,
      status: 1,
      resource: 'user',
      resourceId: Number(userId),
      detail: { roleIds: dto.roleIds },
    })
    return { msg: '角色分配成功' }
  }

  @ApiOperation({ summary: '给用户追加一个角色' })
  @Permissions('user-role:assign')
  @Post('user/:userId/role/:roleId')
  async addRole(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @CurrentUser() user: any,
  ) {
    await this.userRoleService.addRole(Number(userId), Number(roleId))
    await this.auditService.log('user-role:add', {
      userId: user.id,
      username: user.username,
      status: 1,
      resource: 'user',
      resourceId: Number(userId),
      detail: { roleId: Number(roleId) },
    })
    return { msg: '角色已添加' }
  }

  @ApiOperation({ summary: '移除用户的某个角色' })
  @Permissions('user-role:remove')
  @Delete('user/:userId/role/:roleId')
  async removeRole(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @CurrentUser() user: any,
  ) {
    await this.userRoleService.removeRole(Number(userId), Number(roleId))
    await this.auditService.log('user-role:remove', {
      userId: user.id,
      username: user.username,
      status: 1,
      resource: 'user',
      resourceId: Number(userId),
      detail: { roleId: Number(roleId) },
    })
    return { msg: '角色已移除' }
  }
}
