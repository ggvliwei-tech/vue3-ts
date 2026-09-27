/**
 * RbacService 单元测试
 *
 * 核心回归用例（P0）：
 * getUserPermissions 必须 join 角色表并过滤 `r.status = 1`。
 *
 * 历史缺陷：getUserRoles 过滤了禁用角色，getUserPermissions 没有。
 * 于是一个角色被禁用后，用户的 roles 列表变空、permissions 却照旧返回，
 * PermissionsGuard 只看 permissions，照常放行 —— "禁用角色"成了空操作，
 * 管理员以为收回了权限，实际接口全部仍然可访问。
 */

import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston'
import { RbacService } from './rbac.service'
import { RoleEntity } from './entities/role.entity'
import { PermissionEntity } from './entities/permission.entity'
import { UserRoleEntity } from './entities/user-role.entity'
import { RolePermissionEntity } from './entities/role-permission.entity'
import { CacheService } from '../redis/cache.service'

// 链式 QueryBuilder mock：每个方法都返回自身，便于断言调用链
function createQueryBuilderMock(rows: unknown[] = []) {
  const qb = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  }
  return qb
}

describe('RbacService', () => {
  let service: RbacService
  let qb: ReturnType<typeof createQueryBuilderMock>

  const mockRepo = { createQueryBuilder: jest.fn() }
  const mockCacheService = {
    // 直接执行 loader，让缓存层对测试透明
    getOrLoad: jest.fn(
      async (_key: string, _opts: unknown, loader: () => Promise<unknown>) =>
        loader(),
    ),
    del: jest.fn(),
  }
  const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(async () => {
    jest.clearAllMocks()
    qb = createQueryBuilderMock([])
    mockRepo.createQueryBuilder.mockReturnValue(qb)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: getRepositoryToken(RoleEntity), useValue: mockRepo },
        { provide: getRepositoryToken(PermissionEntity), useValue: mockRepo },
        { provide: getRepositoryToken(UserRoleEntity), useValue: mockRepo },
        { provide: getRepositoryToken(RolePermissionEntity), useValue: mockRepo },
        { provide: CacheService, useValue: mockCacheService },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: mockLogger },
      ],
    }).compile()

    service = module.get(RbacService)
  })

  describe('getUserPermissions', () => {
    it('必须 join 角色表并过滤 r.status = 1（否则禁用角色不回收权限）', async () => {
      await service.getUserPermissions(1)

      expect(qb.innerJoin).toHaveBeenCalledWith(
        RoleEntity,
        'r',
        'r.id = ur.role_id',
      )
      expect(qb.andWhere).toHaveBeenCalledWith('r.status = 1')
    })

    it('禁用的角色不应贡献任何权限码', async () => {
      // 模拟 DB 在过滤掉禁用角色后返回空集
      qb.getRawMany.mockResolvedValue([])

      await expect(service.getUserPermissions(1)).resolves.toEqual([])
    })

    it('应把查询结果映射为权限码数组', async () => {
      qb.getRawMany.mockResolvedValue([
        { code: 'user:list' },
        { code: 'book:create' },
      ])

      await expect(service.getUserPermissions(1)).resolves.toEqual([
        'user:list',
        'book:create',
      ])
    })
  })

  describe('getUserRoles', () => {
    it('同样必须过滤 r.status = 1', async () => {
      await service.getUserRoles(1)

      expect(qb.innerJoin).toHaveBeenCalledWith(
        RoleEntity,
        'r',
        'r.id = ur.role_id',
      )
      expect(qb.andWhere).toHaveBeenCalledWith('r.status = 1')
    })
  })

  describe('clearUserCache', () => {
    it('应同时清除角色与权限两个缓存 key', async () => {
      await service.clearUserCache(9)

      expect(mockCacheService.del).toHaveBeenCalledWith(
        'rbac:roles:9',
        'rbac:perms:9',
      )
    })
  })
})
