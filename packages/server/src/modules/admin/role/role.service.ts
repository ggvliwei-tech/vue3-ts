// 注入装饰器
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common'
// 注入 TypeORM Repository
import { InjectRepository } from '@nestjs/typeorm'
// Repository 操作符
import { Repository, In } from 'typeorm'
// 事务管理器类型（create / remove 里把多个写操作收进同一事务）
import type { EntityManager } from 'typeorm'
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
    // 校验 code 唯一。
    // 这一步本质上是 TOCTOU：并发同名创建时两个请求都能通过校验，
    // 最终由 sys_role.code 的唯一索引拦下第二个，抛 ER_DUP_ENTRY →
    // 全局异常过滤器转成 409「数据已存在，请勿重复提交」。这里是快速路径而非安全边界。
    const exists = await this.roleRepo.findOne({ where: { code: dto.code } })
    if (exists) throw new ConflictException(`角色编码已存在：${dto.code}`)

    // 事务：建角色 + 绑初始权限必须同生共死。
    // 拆成两个独立写操作时，若绑定阶段失败（权限码被并发删除等），
    // 会留下一个「创建成功但少绑了权限」的角色——前端拿到的是 500，
    // 用户以为没创建成功，实际上列表里已经多了一条。
    return this.roleRepo.manager.transaction(async (manager) => {
      const role = manager.create(RoleEntity, {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        status: dto.status ?? 1,
        createTime: Date.now(),
      })
      const saved = await manager.save(role)

      if (dto.permissionCodes?.length) {
        await this.bindPermissionsByCode(manager, saved.id, dto.permissionCodes)
      }
      return saved
    })
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

    // 三张表的删除必须收进同一个事务：中途失败会留下「角色没了但 sys_role_permission /
    // sys_user_role 里还挂着它的 id」的孤儿行——权限绑定查不到角色（无害），
    // 但用户侧会一直带着一个指向不存在角色的关联，后续重建同名角色时立刻"复活"旧绑定。
    //
    // 受影响用户 ID **必须在事务内、删 sys_user_role 之前查** ——
    // 关联行删掉之后就再也查不出谁持有该角色，缓存也就永远清不掉了。
    const affectedUserIds = await this.roleRepo.manager.transaction(async (manager) => {
      const userRoles = await manager.find(UserRoleEntity, { where: { roleId: id } })

      await manager.delete(RolePermissionEntity, { roleId: id })
      await manager.delete(UserRoleEntity, { roleId: id })
      await manager.delete(RoleEntity, { id })

      return userRoles.map((ur) => ur.userId)
    })

    // 先删数据，再清缓存，且清缓存**在事务提交之后**（不能搬进事务里）。
    // 顺序反过来（先清后删）会留一个真实的越权窗口：清理与删除之间若有请求进来，
    // 它会读到「仍含该角色」的权限集并重新写进缓存，而此后不会再有人清第二次，
    // 于是被删角色的权限继续放行整个缓存 TTL。
    // 删完再清则不存在这个窗口：清完之后的任何读都只能读到已删除的状态。
    await this.clearUserCaches(affectedUserIds)
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
   *
   * 走传入的 manager 而不是 this.permRepo / this.rolePermRepo，
   * 这样它就跑在 create() 的事务里，与建角色同生共死。
   */
  private async bindPermissionsByCode(manager: EntityManager, roleId: number, codes: string[]): Promise<void> {
    const perms = await manager.find(PermissionEntity, { where: { code: In(codes) } })
    if (perms.length) {
      const rows = perms.map((p) => ({ roleId, permissionId: p.id }))
      await manager.insert(RolePermissionEntity, rows)
    }
  }

  /**
   * 内部：查出持有该角色的所有用户 ID
   */
  private async collectAffectedUserIds(roleId: number): Promise<number[]> {
    const userRoles = await this.userRoleRepo.find({ where: { roleId } })
    return userRoles.map((ur) => ur.userId)
  }

  /**
   * 内部：按用户 ID 批量清理 RBAC 缓存
   */
  private async clearUserCaches(userIds: number[]): Promise<void> {
    await Promise.all(userIds.map((userId) => this.rbacService.clearUserCache(userId)))
  }

  /**
   * 内部：清理持有该角色的所有用户的 RBAC 缓存
   *
   * 适用于「关联行仍然存在」的场景（update / assignPermissionsById）。
   * 删除角色请走 collectAffectedUserIds + clearUserCaches —— 那时关联行已经没了，
   * 本方法会查出空集，静默什么都不清。
   */
  private async clearAffectedUserCache(roleId: number): Promise<void> {
    await this.clearUserCaches(await this.collectAffectedUserIds(roleId))
  }
}
