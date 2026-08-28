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
// 角色服务
import { RoleService } from './role.service'
// DTO
import { CreateRoleDto } from './dto/create-role.dto'
import { UpdateRoleDto } from './dto/update-role.dto'
import { AssignPermissionsDto, AssignPermissionCodesDto } from './dto/assign-permissions.dto'
// 审计服务（用于记录 admin 操作）
import { AuditService } from '../../audit/audit.service'

/**
 * 管理端 - 角色管理
 *
 * 路由前缀：/admin/role
 * 权限码：role:list / role:create / role:update / role:delete / role:assign-permission
 */
@ApiTags('管理端-角色管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/role')
export class RoleController {
  constructor(
    private readonly roleService: RoleService,
    private readonly auditService: AuditService,
  ) {}

  // 角色列表
  @ApiOperation({ summary: '分页查询角色列表' })
  @Permissions('role:list')
  @Get()
  async list(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('keyword') keyword?: string) {
    const _page = Math.max(1, Number(page) || 1)
    const _pageSize = Math.min(100, Math.max(1, Number(pageSize) || 20))
    return this.roleService.findAll(_page, _pageSize, keyword)
  }

  // 全部启用角色（用于下拉框）
  @ApiOperation({ summary: '查询全部启用角色（用于下拉框）' })
  @Permissions('role:list')
  @Get('enabled')
  enabled() {
    return this.roleService.findAllEnabled()
  }

  // 角色详情
  @ApiOperation({ summary: '角色详情（含权限码）' })
  @Permissions('role:list')
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.roleService.findOne(Number(id))
  }

  // 创建角色
  @ApiOperation({ summary: '创建角色' })
  @Permissions('role:create')
  @Post()
  async create(@Body() dto: CreateRoleDto, @CurrentUser() user: any) {
    const role = await this.roleService.create(dto)
    await this.auditService.log('role:create', {
      userId: user.id,
      username: user.username,
      status: 1,
      resource: 'role',
      resourceId: role.id,
      detail: { code: role.code, name: role.name },
    })
    return role
  }

  // 更新角色
  @ApiOperation({ summary: '更新角色基本信息' })
  @Permissions('role:update')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateRoleDto, @CurrentUser() user: any) {
    const role = await this.roleService.update(Number(id), dto)
    await this.auditService.log('role:update', {
      userId: user.id,
      username: user.username,
      status: 1,
      resource: 'role',
      resourceId: role.id,
      detail: { ...dto },
    })
    return role
  }

  // 删除角色
  @ApiOperation({ summary: '删除角色' })
  @Permissions('role:delete')
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    await this.roleService.remove(Number(id))
    await this.auditService.log('role:delete', {
      userId: user.id,
      username: user.username,
      status: 1,
      resource: 'role',
      resourceId: Number(id),
    })
    return { msg: '删除成功' }
  }

  // 按 ID 分配权限
  @ApiOperation({ summary: '给角色分配权限（按权限ID，全量替换）' })
  @Permissions('role:assign-permission')
  @Put(':id/permissions')
  async assignById(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
    @CurrentUser() user: any,
  ) {
    await this.roleService.assignPermissionsById(Number(id), dto.permissionIds)
    await this.auditService.log('role:assign-permission', {
      userId: user.id,
      username: user.username,
      status: 1,
      resource: 'role',
      resourceId: Number(id),
      detail: { permissionIds: dto.permissionIds },
    })
    return { msg: '权限分配成功' }
  }

  // 按编码分配权限
  @ApiOperation({ summary: '给角色分配权限（按权限码，全量替换）' })
  @Permissions('role:assign-permission')
  @Put(':id/permissions/by-code')
  async assignByCode(
    @Param('id') id: string,
    @Body() dto: AssignPermissionCodesDto,
    @CurrentUser() user: any,
  ) {
    await this.roleService.assignPermissionsByCode(Number(id), dto.codes)
    await this.auditService.log('role:assign-permission', {
      userId: user.id,
      username: user.username,
      status: 1,
      resource: 'role',
      resourceId: Number(id),
      detail: { codes: dto.codes },
    })
    return { msg: '权限分配成功' }
  }
}
