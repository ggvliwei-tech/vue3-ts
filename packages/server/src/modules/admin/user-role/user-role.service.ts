// 注入装饰器
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
// 注入 TypeORM Repository
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, In } from 'typeorm'
// 用户实体
import { User } from '../../user/entities/user.entity'
// 角色实体
import { RoleEntity } from '../../rbac/entities/role.entity'
// 用户-角色关联实体
import { UserRoleEntity } from '../../rbac/entities/user-role.entity'
// RBAC 服务（清缓存）
import { RbacService } from '../../rbac/rbac.service'

/**
 * 用户-角色分配服务
 *
 * 职责：
 *  - 查询用户已绑定的角色
 *  - 全量替换用户角色（事务）
 *  - 变更后清 Redis 缓存使权限立即生效
 */
@Injectable()
export class UserRoleService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
    private readonly rbacService: RbacService,
  ) {}

  /**
   * 查询某用户已绑定的角色列表（含角色详情）
   */
  async getUserRoles(userId: number) {
    const user = await this.userRepo.findOne({ where: { id: userId } })
    if (!user) throw new NotFoundException(`用户不存在：id=${userId}`)

    const roles = await this.userRoleRepo
      .createQueryBuilder('ur')
      .innerJoin(RoleEntity, 'r', 'r.id = ur.role_id')
      .where('ur.user_id = :userId', { userId })
      .select(['r.id AS id', 'r.code AS code', 'r.name AS name', 'r.status AS status'])
      .getRawMany()
    return { userId, username: user.username, roles }
  }

  /**
   * 查询某角色下的所有用户（成员列表）
   */
  async getRoleUsers(roleId: number, page = 1, pageSize = 20) {
    const role = await this.roleRepo.findOne({ where: { id: roleId } })
    if (!role) throw new NotFoundException(`角色不存在：id=${roleId}`)

    const qb = this.userRoleRepo
      .createQueryBuilder('ur')
      .innerJoin(User, 'u', 'u.id = ur.user_id')
      .where('ur.role_id = :roleId', { roleId })
      .select(['u.id AS id', 'u.username AS username', 'u.phone AS phone', 'u.status AS status', 'ur.createTime AS createTime'])
      .orderBy('ur.createTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
    const [list, total] = await qb.getRawMany().then(async (list) => {
      const cnt = await this.userRoleRepo.count({ where: { roleId } })
      return [list, cnt]
    })
    return { roleId, roleCode: role.code, list, total, page, pageSize }
  }

  /**
   * 给用户分配角色（全量替换）
   * - 内置 admin 角色不允许被移除（避免锁死）
   */
  async assignRoles(userId: number, roleIds: number[]): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } })
    if (!user) throw new NotFoundException(`用户不存在：id=${userId}`)

    if (roleIds.length) {
      const roles = await this.roleRepo.find({ where: { id: In(roleIds) } })
      if (roles.length !== roleIds.length) {
        throw new BadRequestException('部分角色 ID 不存在')
      }

      // 校验：不能剥夺 admin 用户的 admin 角色（防止锁死超级管理员）
      if (user.username === 'admin') {
        const adminRole = roles.find((r) => r.code === 'admin')
        if (!adminRole) {
          throw new BadRequestException('超级管理员 admin 必须保留 admin 角色')
        }
      }
    } else {
      // 不允许把 admin 用户清空所有角色
      if (user.username === 'admin') {
        throw new BadRequestException('超级管理员 admin 必须保留至少一个角色')
      }
    }

    await this.userRoleRepo.manager.transaction(async (manager) => {
      await manager.delete(UserRoleEntity, { userId })
      if (roleIds.length) {
        const rows = roleIds.map((roleId) => ({ userId, roleId, createTime: Date.now() }))
        await manager.insert(UserRoleEntity, rows)
      }
    })

    // 变更后清缓存，权限立即生效
    await this.rbacService.clearUserCache(userId)
  }

  /**
   * 给用户追加一个角色（不影响已有角色）
   */
  async addRole(userId: number, roleId: number): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } })
    if (!user) throw new NotFoundException(`用户不存在：id=${userId}`)
    const role = await this.roleRepo.findOne({ where: { id: roleId } })
    if (!role) throw new NotFoundException(`角色不存在：id=${roleId}`)

    const exists = await this.userRoleRepo.findOne({ where: { userId, roleId } })
    if (exists) throw new BadRequestException('该用户已拥有此角色')

    await this.userRoleRepo.insert({ userId, roleId, createTime: Date.now() })
    await this.rbacService.clearUserCache(userId)
  }

  /**
   * 移除用户的某个角色
   */
  async removeRole(userId: number, roleId: number): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } })
    if (!user) throw new NotFoundException(`用户不存在：id=${userId}`)

    // 保护 admin 用户不被剥夺 admin 角色
    if (user.username === 'admin') {
      const role = await this.roleRepo.findOne({ where: { id: roleId } })
      if (role?.code === 'admin') {
        throw new BadRequestException('超级管理员 admin 不能被剥夺 admin 角色')
      }
    }

    await this.userRoleRepo.delete({ userId, roleId })
    await this.rbacService.clearUserCache(userId)
  }
}
