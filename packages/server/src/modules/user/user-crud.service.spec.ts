/**
 * UserCrudService 单元测试
 *
 * 测试范围：
 *  1. create - 用户名重复抛 ConflictException
 *  2. create - 手机号重复抛 ConflictException
 *  3. create - 密码应被 bcrypt 哈希（不存明文）
 *  4. create - 数据库唯一约束冲突（1062）兜底
 *  5. findById - 不存在时抛 NotFoundException
 *  6. findById - 应返回角色和权限码
 *  7. findAll - 不返回 password 字段
 *  8. toggleStatus - 状态在 0/1 间切换，禁用时调用 removeAll
 *  9. toggleStatus - 应发审计事件
 *
 * AuthService 涉及的 login/refresh/forceKick 流程测试见 auth.service.spec.ts
 */

import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { getRepositoryToken } from '@nestjs/typeorm'
import { User } from './entities/user.entity'
import { RbacService } from '../rbac/rbac.service'
import { SmsService } from '../sms/sms.service'
import { SessionService } from '../auth/session.service'
import { UserCrudService } from './user-crud.service'
import { AuditEvents } from '../audit/audit.events'
import * as bcrypt from 'bcrypt'
import { QueryFailedError } from 'typeorm'

// 两处走 createQueryBuilder 的链式调用，mock 需支持链式返回自身：
//  - findAll：select / orderBy / skip / take / andWhere → getManyAndCount
//  - toggleStatus：update / set / where → execute
const mockQb = {
  select: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  execute: jest.fn(async () => ({ affected: 1 })),
}

const mockUserRepo = {
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  createQueryBuilder: jest.fn(() => mockQb),
  create: jest.fn((dto: any) => dto),
  save: jest.fn(async (user: any) => ({ id: 1, ...user })),
}

const mockRbacService = {
  getUserRoles: jest.fn(async () => ['admin']),
  getUserPermissions: jest.fn(async () => ['user:list', 'user:create']),
  getRolesByUserIds: jest.fn(async () => new Map<number, string[]>()),
  clearUserCache: jest.fn(async () => undefined),
}

const mockSessionService = {
  removeAll: jest.fn(async () => undefined),
  remove: jest.fn(async () => undefined),
}

const mockEvents = {
  emit: jest.fn(),
}

describe('UserCrudService', () => {
  let service: UserCrudService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserCrudService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: RbacService, useValue: mockRbacService },
        { provide: SmsService, useValue: {} },
        { provide: SessionService, useValue: mockSessionService },
        { provide: EventEmitter2, useValue: mockEvents },
      ],
    }).compile()
    service = module.get(UserCrudService)
  })

  describe('create - 注册', () => {
    const dto = { username: 'newuser', password: 'rawPwd123', phone: '13800138000' }

    it('用户名重复时抛 ConflictException', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({ id: 99, username: 'newuser' })
      await expect(service.create(dto as any)).rejects.toThrow(ConflictException)
    })

    it('手机号重复时抛 ConflictException', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce(null)
      mockUserRepo.findOne.mockResolvedValueOnce({ id: 99, phone: '13800138000' })
      await expect(service.create(dto as any)).rejects.toThrow(ConflictException)
    })

    it('密码应被 bcrypt 哈希（不存明文）', async () => {
      mockUserRepo.findOne.mockResolvedValue(null)
      mockUserRepo.create.mockImplementation((data) => data)
      mockUserRepo.save.mockImplementation(async (u) => ({ id: 1, ...u }))

      await service.create(dto)

      const saveCall = mockUserRepo.save.mock.calls[0][0]
      expect(saveCall.password).not.toBe(dto.password)
      expect(saveCall.password).toMatch(/^\$2[aby]\$/)
      const verified = await bcrypt.compare(dto.password, saveCall.password)
      expect(verified).toBe(true)
    })

    it('数据库唯一约束冲突（1062）应兜底抛 ConflictException', async () => {
      mockUserRepo.findOne.mockResolvedValue(null)
      const driverErr = Object.assign(new Error('ER_DUP_ENTRY'), {
        errno: 1062,
        code: 'ER_DUP_ENTRY',
      })
      const queryErr = new QueryFailedError('INSERT ...', [], driverErr)
      mockUserRepo.save.mockRejectedValueOnce(queryErr)

      await expect(service.create(dto as any)).rejects.toThrow(ConflictException)
    })
  })

  describe('findById', () => {
    it('用户不存在时抛 NotFoundException', async () => {
      mockUserRepo.findOneBy.mockResolvedValueOnce(null)
      await expect(service.findById(999)).rejects.toThrow(NotFoundException)
    })

    it('应同步返回角色编码和权限码，且不含 password 字段', async () => {
      mockUserRepo.findOneBy.mockResolvedValueOnce({
        id: 1, username: 'alice', password: 'hashed', status: 1, phone: '13800000000', createTime: 1,
      })
      const result = await service.findById(1)
      expect(result.id).toBe(1)
      expect(result.roles).toEqual(['admin'])
      expect(result.permissions).toEqual(['user:list', 'user:create'])
      expect(result).not.toHaveProperty('password')
    })
  })

  describe('findAll', () => {
    it('查询时不返回 password / phone 字段（通过 select 控制）', async () => {
      mockQb.getManyAndCount.mockResolvedValueOnce([
        [{ id: 1, username: 'a', status: 1, createTime: 1 }],
        1,
      ])
      mockRbacService.getRolesByUserIds.mockResolvedValueOnce(
        new Map<number, string[]>([[1, ['admin']]]),
      )

      const result = await service.findAll(1, 20)

      expect(result.list).toHaveLength(1)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
      // 角色通过单次 batch SQL 挂载，避免 N+1
      expect(result.list[0].roles).toEqual(['admin'])
      expect(mockRbacService.getRolesByUserIds).toHaveBeenCalledWith([1])

      // select 白名单不含 password / phone（PII 不应回传普通列表）
      const selected = mockQb.select.mock.calls[0][0] as string[]
      expect(selected).toEqual(['u.id', 'u.username', 'u.status', 'u.createTime'])
      expect(selected).not.toContain('u.password')
      expect(selected).not.toContain('u.phone')

      // 分页参数正确换算
      expect(mockQb.skip).toHaveBeenCalledWith(0)
      expect(mockQb.take).toHaveBeenCalledWith(20)
    })

    it('传入 keyword / status 时追加 andWhere 条件', async () => {
      mockQb.getManyAndCount.mockResolvedValueOnce([[], 0])

      await service.findAll(2, 10, { keyword: 'ali', status: 1 })

      expect(mockQb.andWhere).toHaveBeenCalledWith('u.username LIKE :keyword', {
        keyword: '%ali%',
      })
      expect(mockQb.andWhere).toHaveBeenCalledWith('u.status = :status', { status: 1 })
      expect(mockQb.skip).toHaveBeenCalledWith(10)
      expect(mockQb.take).toHaveBeenCalledWith(10)
    })
  })

  describe('toggleStatus - 切换用户状态', () => {
    // 两次 findOneBy：第一次读目标用户，第二次回读取反后的真实值。
    // 必须显式给出第二次的返回值，否则测试会走 `?? target.status === 1 ? 0 : 1`
    // 的兜底分支 —— 那样等于没验证「回读」，断言通过也说明不了什么。
    function stubToggle(oldStatus: 0 | 1, newStatus: 0 | 1) {
      mockUserRepo.findOneBy
        .mockResolvedValueOnce({ id: 1, username: 'alice', status: oldStatus, phone: '1', createTime: 1 })
        .mockResolvedValueOnce({ id: 1, username: 'alice', status: newStatus })
    }

    it('1 → 0 时调用 removeAll（禁用需吊销所有会话）', async () => {
      stubToggle(1, 0)

      const result = await service.toggleStatus(1)
      expect(result.status).toBe(0)
      expect(mockSessionService.removeAll).toHaveBeenCalledWith(1)
    })

    it('0 → 1 时不应调用 removeAll', async () => {
      stubToggle(0, 1)

      const result = await service.toggleStatus(1)
      expect(result.status).toBe(1)
      expect(mockSessionService.removeAll).not.toHaveBeenCalled()
    })

    it('用户不存在时抛 NotFoundException', async () => {
      mockUserRepo.findOneBy.mockResolvedValueOnce(null)
      await expect(service.toggleStatus(999)).rejects.toThrow(NotFoundException)
    })

    it('切换状态后应发审计事件', async () => {
      stubToggle(1, 0)

      await service.toggleStatus(1)
      expect(mockEvents.emit).toHaveBeenCalledWith(
        AuditEvents.LOG,
        expect.objectContaining({
          action: 'toggle-status',
          ctx: expect.objectContaining({ status: 1 }),
        }),
      )
    })

    // 钉住「并发下不丢更新」这条不变量：取反必须交给数据库用一条 UPDATE 完成。
    // 若有人改回「读实体 → 改 status → save()」，两个管理员同时点同一个用户时
    // 双方会各自读到同一个旧值、各自取反成同一个新值，后写入的覆盖先写入的 ——
    // 两次点击只生效一次，其中一人的意图被静默丢弃。
    it('用一条原子 UPDATE 取反，而不是 read-modify-write 的 save()', async () => {
      stubToggle(1, 0)

      await service.toggleStatus(1)

      expect(mockQb.set).toHaveBeenCalledWith({ status: expect.any(Function) })
      expect(mockQb.where).toHaveBeenCalledWith('id = :id', { id: 1 })
      expect(mockQb.execute).toHaveBeenCalled()
      expect(mockUserRepo.save).not.toHaveBeenCalled()
    })

    it('内置超管 admin 启用态不允许被禁用', async () => {
      mockUserRepo.findOneBy.mockResolvedValueOnce({
        id: 1, username: 'admin', status: 1, phone: '1', createTime: 1,
      })

      await expect(service.toggleStatus(1)).rejects.toThrow(BadRequestException)
      expect(mockQb.execute).not.toHaveBeenCalled()
    })

    it('admin 处于禁用态时放行启用（唯一的自助恢复路径）', async () => {
      mockUserRepo.findOneBy
        .mockResolvedValueOnce({ id: 1, username: 'admin', status: 0, phone: '1', createTime: 1 })
        .mockResolvedValueOnce({ id: 1, username: 'admin', status: 1 })

      const result = await service.toggleStatus(1)
      expect(result.status).toBe(1)
      expect(mockQb.execute).toHaveBeenCalled()
    })
  })
})
