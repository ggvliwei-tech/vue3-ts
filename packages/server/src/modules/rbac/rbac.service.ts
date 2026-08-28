// 注入装饰器
import { Inject, Injectable } from '@nestjs/common'
// nest-winston 日志
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston'
import { Logger as WinstonLogger } from 'winston'
// 注入 TypeORM Repository
import { InjectRepository } from '@nestjs/typeorm'
// Repository 类型
import { Repository } from 'typeorm'
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
 *
 * 容错降级（C2 修复）：
 *  - Redis 不可用时降级到直接查 DB，绝不让缓存成为单点故障
 *  - 写缓存失败仅记日志，不抛异常（不影响 RBAC 校验）
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
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: WinstonLogger,
  ) {}

  /**
   * 读缓存，失败返回 null（不抛异常）
   */
  private async readCache(key: string): Promise<string[] | null> {
    try {
      const cached = await this.redisService.get(key)
      if (!cached) return null
      return JSON.parse(cached)
    } catch (err) {
      this.logger.warn(
        `[Rbac] 缓存读取失败，降级到 DB: ${(err as Error).message}`,
      )
      return null
    }
  }

  /**
   * 写缓存，失败仅记日志（不影响主流程）
   */
  private async writeCache(key: string, value: unknown): Promise<void> {
    try {
      await this.redisService.setJson(key, value, CACHE_TTL)
    } catch (err) {
      this.logger.warn(
        `[Rbac] 缓存写入失败: ${(err as Error).message}`,
      )
    }
  }

  /**
   * 获取用户的所有角色编码（带缓存，Redis 故障时降级到 DB）
   * @param userId 用户 ID
   * @returns 角色编码数组，如 ['admin', 'editor']
   */
  async getUserRoles(userId: number): Promise<string[]> {
    const cacheKey = `${ROLE_CACHE_KEY}${userId}`
    // 1. 查缓存（Redis 不可用时静默降级）
    const cached = await this.readCache(cacheKey)
    if (cached) return cached
    // 2. 查 DB：user_role JOIN role
    const rows = await this.userRoleRepo
      .createQueryBuilder('ur')
      .innerJoin(RoleEntity, 'r', 'r.id = ur.role_id')
      .where('ur.user_id = :userId', { userId })
      .andWhere('r.status = 1')
      .select('r.code', 'code')
      .getRawMany<{ code: string }>()
    const codes = rows.map((r) => r.code)
    // 3. 写缓存（失败仅记日志）
    await this.writeCache(cacheKey, codes)
    return codes
  }

  /**
   * 获取用户的所有权限码（带缓存，Redis 故障时降级到 DB）
   * @param userId 用户 ID
   * @returns 权限码数组，如 ['user:list', 'book:create']
   */
  async getUserPermissions(userId: number): Promise<string[]> {
    const cacheKey = `${PERM_CACHE_KEY}${userId}`
    // 1. 查缓存
    const cached = await this.readCache(cacheKey)
    if (cached) return cached
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
    await this.writeCache(cacheKey, codes)
    return codes
  }

  /**
   * 清除用户的角色/权限缓存
   * 当 admin 修改用户角色时调用，使权限变更立即生效
   * Redis 不可用时静默忽略（缓存本来就没生效）
   */
  async clearUserCache(userId: number): Promise<void> {
    try {
      await Promise.all([
        this.redisService.del(`${ROLE_CACHE_KEY}${userId}`),
        this.redisService.del(`${PERM_CACHE_KEY}${userId}`),
      ])
    } catch (err) {
      this.logger.warn(
        `[Rbac] 缓存清除失败: ${(err as Error).message}`,
      )
    }
  }
}
