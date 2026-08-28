// 注入装饰器
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common'
// 注入 TypeORM Repository
import { InjectRepository } from '@nestjs/typeorm'
// Repository 操作符
import { Repository, In } from 'typeorm'
// 角色实体
import { RoleEntity } from '../../rbac/entities/role.entity'
// 权限实体
import { PermissionEntity } from '../../rbac/entities/permission.entity'
// 角色-权限关联实体
import { RolePermissionEntity } from '../../rbac/entities/role-permission.entity'
// 用户-角色关联实体
import { UserRoleEntity } from '../../rbac/entities/user-role.entity'
// 创建/更新 DTO
import { CreateRoleDto } from './dto/create-role.dto'
import { UpdateRoleDto } from './dto/update-role.dto'
// RBAC 服务（用于清理用户权限缓存）
import { RbacService } from '../../rbac/rbac.service'

/**
 * 角色管理服务
 *
 * 职责：
 *  - 角色 CRUD（含权限绑定）
 *  - 删除角色时同步清理 sys_role_permission / sys_user_role
 *  - 角色权限变更时清理所有受影响用户的 Redis 缓存，使权限立即生效
 */
@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(PermissionEntity)
    private readonly permRepo: Repository<PermissionEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermRepo: Repository<RolePermissionEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
    private readonly rbacService: RbacService,
  ) {}

  /**
   * 分页查询角色列表
   */
  async findAll(page = 1, pageSize = 20, keyword?: string) {
    const qb = this.roleRepo.createQueryBuilder('r')
    if (keyword) {
      qb.where('r.code LIKE :kw OR r.name LIKE :kw', { kw: `%${keyword}%` })
    }
    qb.orderBy('r.createTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
    const [list, total] = await qb.getManyAndCount()
    return { list, total, page, pageSize }
  }

  /**
   * 查询全部启用的角色（用于下拉框）
   */
  async findAllEnabled(): Promise<RoleEntity[]> {
    return this.roleRepo.find({ where: { status: 1 }, order: { createTime: 'ASC' } })
  }

  /**
   * 角色详情（含权限码列表）
   */
  async findOne(id: number) {
    const role = await this.roleRepo.findOne({ where: { id } })
    if (!role) throw new NotFoundException(`角色不存在：id=${id}`)

    // 关联查询该角色的权限码
    const perms = await this.rolePermRepo
      .createQueryBuilder('rp')
      .innerJoin(PermissionEntity, 'p', 'p.id = rp.permission_id')
      .where('rp.role_id = :id', { id })
      .select(['p.id AS id', 'p.code AS code', 'p.name AS name', 'p.module AS module'])
      .getRawMany()

    return { ...role, permissions: perms }
  }

  /**
   * 创建角色
   * - code 全局唯一
   * - 可选地一次性绑定若干权限码
   */
  async create(dto: CreateRoleDto): Promise<RoleEntity> {
    // 校验 code 唯一
    const exists = await this.roleRepo.findOne({ where: { code: dto.code } })
    if (exists) throw new ConflictException(`角色编码已存在：${dto.code}`)

    const role = this.roleRepo.create({
      code: dto.code,
      name: dto.name,
      description: dto.description,
      status: dto.status ?? 1,
      createTime: Date.now(),
    })
    const saved = await this.roleRepo.save(role)

    // 可选：绑定初始权限
    if (dto.permissionCodes?.length) {
      await this.bindPermissionsByCode(saved.id, dto.permissionCodes)
    }
    return saved
  }

  /**
   * 更新角色基本信息（不允许改 code）
   */
  async update(id: number, dto: UpdateRoleDto): Promise<RoleEntity> {
    const role = await this.roleRepo.findOne({ where: { id } })
    if (!role) throw new NotFoundException(`角色不存在：id=${id}`)

    // 保护三个内置角色不被禁用（防止误操作锁死 admin）
    if (dto.status === 0 && ['admin', 'user', 'editor'].includes(role.code)) {
      throw new BadRequestException(`内置角色 ${role.code} 不允许禁用`)
    }

    Object.assign(role, dto)
    const saved = await this.roleRepo.save(role)

    // 状态变更需要清缓存（被禁用的角色持有的用户权限会减少）
    await this.clearAffectedUserCache(id)
    return saved
  }

  /**
   * 删除角色
   * - 内置角色不允许删除
   * - 同时清理 sys_role_permission / sys_user_role 关联
   */
  async remove(id: number): Promise<void> {
    const role = await this.roleRepo.findOne({ where: { id } })
    if (!role) throw new NotFoundException(`角色不存在：id=${id}`)

    if (['admin', 'user', 'editor'].includes(role.code)) {
      throw new BadRequestException(`内置角色 ${role.code} 不允许删除`)
    }

    // 先清缓存，再删关联和角色
    await this.clearAffectedUserCache(id)
    await this.rolePermRepo.delete({ roleId: id })
    await this.userRoleRepo.delete({ roleId: id })
    await this.roleRepo.delete({ id })
  }

  /**
   * 给角色绑定权限（替换式：传 IDs 即覆盖）
   */
  async assignPermissionsById(roleId: number, permissionIds: number[]): Promise<void> {
    const role = await this.roleRepo.findOne({ where: { id: roleId } })
    if (!role) throw new NotFoundException(`角色不存在：id=${roleId}`)

    // 校验所有 ID 都存在
    if (permissionIds.length) {
      const count = await this.permRepo.count({ where: { id: In(permissionIds) } })
      if (count !== permissionIds.length) {
        throw new BadRequestException('部分权限 ID 不存在')
      }
    }

    // 事务：先清后插
    await this.rolePermRepo.manager.transaction(async (manager) => {
      await manager.delete(RolePermissionEntity, { roleId })
      if (permissionIds.length) {
        const rows = permissionIds.map((permissionId) => ({ roleId, permissionId }))
        await manager.insert(RolePermissionEntity, rows)
      }
    })

    // 角色权限变化，清缓存
    await this.clearAffectedUserCache(roleId)
  }

  /**
   * 按权限码绑定（前端友好）
   */
  async assignPermissionsByCode(roleId: number, codes: string[]): Promise<void> {
    if (!codes.length) {
      await this.assignPermissionsById(roleId, [])
      return
    }
    const perms = await this.permRepo.find({ where: { code: In(codes) } })
    if (perms.length !== codes.length) {
      const foundCodes = perms.map((p) => p.code)
      const missing = codes.filter((c) => !foundCodes.includes(c))
      throw new BadRequestException(`权限码不存在：${missing.join(', ')}`)
    }
    await this.assignPermissionsById(roleId, perms.map((p) => p.id))
  }

  /**
   * 内部：按 code 绑定权限（创建角色时调用）
   */
  private async bindPermissionsByCode(roleId: number, codes: string[]): Promise<void> {
    const perms = await this.permRepo.find({ where: { code: In(codes) } })
    if (perms.length) {
      const rows = perms.map((p) => ({ roleId, permissionId: p.id }))
      await this.rolePermRepo.insert(rows)
    }
  }

  /**
   * 内部：清理持有该角色的所有用户的 RBAC 缓存
   */
  private async clearAffectedUserCache(roleId: number): Promise<void> {
    const userRoles = await this.userRoleRepo.find({ where: { roleId } })
    await Promise.all(userRoles.map((ur) => this.rbacService.clearUserCache(ur.userId)))
  }
}
