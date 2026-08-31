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
// 二级缓存服务（L1 进程内 + L2 Redis，含雪崩/击穿/穿透防护）
import { CacheService } from '../redis/cache.service'

// Redis 缓存 key 前缀
const ROLE_CACHE_PREFIX = 'rbac:roles:'
const PERM_CACHE_PREFIX = 'rbac:perms:'
// 缓存有效期（10 分钟），TTL 抖动 ±20% 防雪崩
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
    // 二级缓存服务（L1 + L2 + 雪崩/击穿/穿透防护）
    private readonly cache: CacheService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: WinstonLogger,
  ) {}

  /**
   * 获取用户的所有角色编码（带缓存，Redis 故障时降级到 DB）
   * @param userId 用户 ID
   * @returns 角色编码数组，如 ['admin', 'editor']
   */
  async getUserRoles(userId: number): Promise<string[]> {
    const cacheKey = `${ROLE_CACHE_PREFIX}${userId}`
    // getOrLoad 内部处理：L1/L2 命中返回；未命中触发 loader（in-flight 去重）
    return (
      (await this.cache.getOrLoad<string[]>(
        cacheKey,
        { ttl: CACHE_TTL, prefix: ROLE_CACHE_PREFIX },
        async () => {
          const rows = await this.userRoleRepo
            .createQueryBuilder('ur')
            .innerJoin(RoleEntity, 'r', 'r.id = ur.role_id')
            .where('ur.user_id = :userId', { userId })
            .andWhere('r.status = 1')
            .select('r.code', 'code')
            .getRawMany<{ code: string }>()
          return rows.map((r) => r.code)
        },
      )) ?? []
    )
  }

  /**
   * 批量获取用户的角色编码（用户列表场景）
   *
   * 单 SQL 一次查所有 userId 的角色，前端用一次 IN (...) 即可渲染 N 行
   * 不走 Redis 缓存（列表页短生命周期，缓存收益低 / 一致性收益高）
   *
   * @param userIds 用户 ID 列表
   * @returns Map<userId, roleCodes[]>
   */
  async getRolesByUserIds(
    userIds: number[],
  ): Promise<Map<number, string[]>> {
    const result = new Map<number, string[]>()
    // 空数组短路，避免 IN () 语法错误
    if (userIds.length === 0) return result

    const rows = await this.userRoleRepo
      .createQueryBuilder('ur')
      .innerJoin(RoleEntity, 'r', 'r.id = ur.role_id')
      .where('ur.user_id IN (:...userIds)', { userIds })
      .andWhere('r.status = 1')
      .select(['ur.user_id AS userId', 'r.code AS code'])
      .getRawMany<{ userId: number; code: string }>()

    // 初始化每个 userId 空数组，避免前端拿不到 key
    for (const id of userIds) result.set(id, [])
    for (const row of rows) {
      const list = result.get(row.userId)
      if (list) list.push(row.code)
    }
    return result
  }

  /**
   * 获取用户的所有权限码（带缓存，Redis 故障时降级到 DB）
   * @param userId 用户 ID
   * @returns 权限码数组，如 ['user:list', 'book:create']
   */
  async getUserPermissions(userId: number): Promise<string[]> {
    const cacheKey = `${PERM_CACHE_PREFIX}${userId}`
    return (
      (await this.cache.getOrLoad<string[]>(
        cacheKey,
        { ttl: CACHE_TTL, prefix: PERM_CACHE_PREFIX },
        async () => {
          const rows = await this.userRoleRepo
            .createQueryBuilder('ur')
            .innerJoin(RolePermissionEntity, 'rp', 'rp.role_id = ur.role_id')
            .innerJoin(PermissionEntity, 'p', 'p.id = rp.permission_id')
            .where('ur.user_id = :userId', { userId })
            .select('p.code', 'code')
            .getRawMany<{ code: string }>()
          return rows.map((r) => r.code)
        },
      )) ?? []
    )
  }

  /**
   * 清除用户的角色/权限缓存
   * 当 admin 修改用户角色时调用，使权限变更立即生效
   * Redis 不可用时静默忽略（缓存本来就没生效）
   */
  async clearUserCache(userId: number): Promise<void> {
    // 同步清 L1 + L2（失败仅记日志，由 CacheService 内部吞）
    await this.cache.del(
      `${ROLE_CACHE_PREFIX}${userId}`,
      `${PERM_CACHE_PREFIX}${userId}`,
    )
  }
}
