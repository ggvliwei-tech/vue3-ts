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
// 权限服务
import { PermissionService } from './permission.service'
// DTO
import { CreatePermissionDto } from './dto/create-permission.dto'
import { UpdatePermissionDto } from './dto/update-permission.dto'
// 审计服务
import { AuditService } from '../../audit/audit.service'

/**
 * 管理端 - 权限管理
 *
 * 路由前缀：/admin/permission
 * 权限码：permission:list / permission:create / permission:update / permission:delete
 */
@ApiTags('管理端-权限管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/permission')
export class PermissionController {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
  ) {}

  @ApiOperation({ summary: '分页查询权限列表' })
  @Permissions('permission:list')
  @Get()
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('module') module?: string,
  ) {
    const _page = Math.max(1, Number(page) || 1)
    const _pageSize = Math.min(100, Math.max(1, Number(pageSize) || 20))
    return this.permissionService.findAll(_page, _pageSize, { keyword, module })
  }

  @ApiOperation({ summary: '权限列表按模块分组（用于权限树）' })
  @Permissions('permission:list')
  @Get('grouped')
  grouped() {
    return this.permissionService.findAllGroupedByModule()
  }

  @ApiOperation({ summary: '查询所有模块（用于筛选下拉框）' })
  @Permissions('permission:list')
  @Get('modules')
  modules() {
    return this.permissionService.findAllModules()
  }

  @ApiOperation({ summary: '权限详情' })
  @Permissions('permission:list')
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.permissionService.findOne(Number(id))
  }

  @ApiOperation({ summary: '创建权限' })
  @Permissions('permission:create')
  @Post()
  async create(@Body() dto: CreatePermissionDto, @CurrentUser() user: any) {
    const perm = await this.permissionService.create(dto)
    await this.auditService.log('permission:create', {
      userId: user.id,
      username: user.username,
      status: 1,
      resource: 'permission',
      resourceId: perm.id,
      detail: { code: perm.code, name: perm.name, module: perm.module },
    })
    return perm
  }

  @ApiOperation({ summary: '更新权限' })
  @Permissions('permission:update')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdatePermissionDto, @CurrentUser() user: any) {
    const perm = await this.permissionService.update(Number(id), dto)
    await this.auditService.log('permission:update', {
      userId: user.id,
      username: user.username,
      status: 1,
      resource: 'permission',
      resourceId: perm.id,
      detail: { ...dto },
    })
    return perm
  }

  @ApiOperation({ summary: '删除权限（需先解除角色绑定）' })
  @Permissions('permission:delete')
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    await this.permissionService.remove(Number(id))
    await this.auditService.log('permission:delete', {
      userId: user.id,
      username: user.username,
      status: 1,
      resource: 'permission',
      resourceId: Number(id),
    })
    return { msg: '删除成功' }
  }
}
