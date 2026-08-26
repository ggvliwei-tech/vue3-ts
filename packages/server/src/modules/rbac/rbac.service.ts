// 注入装饰器
import { Injectable } from '@nestjs/common'
// 注入 TypeORM Repository
import { InjectRepository } from '@nestjs/typeorm'
// Repository 类型
import { Repository, In } from 'typeorm'
// 导入 RBAC 相关 Entity
import { RoleEntity } from './entities/role.entity'
import { PermissionEntity } from './entities/permission.entity'
import { UserRoleEntity } from './entities/user-role.entity'
import { RolePermissionEntity } from './entities/role-permission.entity'
// Redis 服务（用于缓存）
import { RedisService } from '../redis/redis.service'

// Redis 缓存 key 前缀
const ROLE_CACHE_KEY = 'rbac:roles:'
const PERM_CACHE_KEY = 'rbac:perms:'
// 缓存有效期（10 分钟），配合权限变更可主动清除
const CACHE_TTL = 10 * 60

/**
 * RBAC 服务
 *
 * 提供：
 *  - getUserRoles(userId)：获取用户拥有的角色编码列表
 *  - getUserPermissions(userId)：获取用户拥有的权限码列表
 *  - clearUserCache(userId)：清除用户的角色/权限缓存（角色变更时调用）
 *
 * 性能优化：
 *  - 角色/权限数据写入 JWT payload 不需要实时性，每次请求都查 DB 代价高
 *  - 用 Redis 缓存 10 分钟，期间 admin 调整权限最长延迟 10 分钟生效
 *  - 关键操作（如 forceKick）可主动 clearUserCache 立即生效
 */
@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(PermissionEntity)
    private readonly permRepo: Repository<PermissionEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermRepo: Repository<RolePermissionEntity>,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 获取用户的所有角色编码（带缓存）
   * @param userId 用户 ID
   * @returns 角色编码数组，如 ['admin', 'editor']
   */
  async getUserRoles(userId: number): Promise<string[]> {
    const cacheKey = `${ROLE_CACHE_KEY}${userId}`
    // 1. 先查 Redis 缓存
    const cached = await this.redisService.get(cacheKey)
    if (cached) {
      try {
        return JSON.parse(cached)
      } catch {
        // 缓存损坏时继续走 DB
      }
    }
    // 2. 查 DB：user_role JOIN role
    const rows = await this.userRoleRepo
      .createQueryBuilder('ur')
      .innerJoin(RoleEntity, 'r', 'r.id = ur.role_id')
      .where('ur.user_id = :userId', { userId })
      .andWhere('r.status = 1')
      .select('r.code', 'code')
      .getRawMany<{ code: string }>()
    const codes = rows.map((r) => r.code)
    // 3. 写入缓存
    await this.redisService.setJson(cacheKey, codes, CACHE_TTL)
    return codes
  }

  /**
   * 获取用户的所有权限码（带缓存）
   * @param userId 用户 ID
   * @returns 权限码数组，如 ['user:list', 'book:create']
   */
  async getUserPermissions(userId: number): Promise<string[]> {
    const cacheKey = `${PERM_CACHE_KEY}${userId}`
    // 1. 查缓存
    const cached = await this.redisService.get(cacheKey)
    if (cached) {
      try {
        return JSON.parse(cached)
      } catch {
        // fallthrough
      }
    }
    // 2. 查 DB：user_role → role_permission → permission
    const rows = await this.userRoleRepo
      .createQueryBuilder('ur')
      .innerJoin(RolePermissionEntity, 'rp', 'rp.role_id = ur.role_id')
      .innerJoin(PermissionEntity, 'p', 'p.id = rp.permission_id')
      .where('ur.user_id = :userId', { userId })
      .select('p.code', 'code')
      .getRawMany<{ code: string }>()
    const codes = rows.map((r) => r.code)
    // 3. 写缓存
    await this.redisService.setJson(cacheKey, codes, CACHE_TTL)
    return codes
  }

  /**
   * 清除用户的角色/权限缓存
   * 当 admin 修改用户角色时调用，使权限变更立即生效
   */
  async clearUserCache(userId: number): Promise<void> {
    await Promise.all([
      this.redisService.del(`${ROLE_CACHE_KEY}${userId}`),
      this.redisService.del(`${PERM_CACHE_KEY}${userId}`),
    ])
  }
}
