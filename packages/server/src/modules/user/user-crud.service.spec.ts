/**
 * UserCrudService 单元测试（C5 拆分后）
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
import { ConflictException, NotFoundException } from '@nestjs/common'
import { getRepositoryToken } from '@nestjs/typeorm'
import { User } from './entities/user.entity'
import { RbacService } from '../rbac/rbac.service'
import { SmsService } from '../sms/sms.service'
import { SessionService } from '../auth/session.service'
import { UserCrudService } from './user-crud.service'
import { AuditEvents } from '../audit/audit.events'
import * as bcrypt from 'bcrypt'
import { QueryFailedError } from 'typeorm'

const mockUserRepo = {
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(async () => [[], 0]),
  create: jest.fn((dto) => dto),
  save: jest.fn(async (user) => ({ id: 1, ...user })),
}

const mockRbacService = {
  getUserRoles: jest.fn(async () => ['admin']),
  getUserPermissions: jest.fn(async () => ['user:list', 'user:create']),
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

      await service.create(dto as any)

      const saveCall = mockUserRepo.save.mock.calls[0][0]
      expect(saveCall.password).not.toBe(dto.password)
      expect(saveCall.password).toMatch(/^\$2[aby]\$/)
      const verified = await bcrypt.compare(dto.password, saveCall.password)
      expect(verified).toBe(true)
    })

    it('数据库唯一约束冲突（1062）应兜底抛 ConflictException', async () => {
      mockUserRepo.findOne.mockResolvedValue(null)
      const driverErr = { errno: 1062, code: 'ER_DUP_ENTRY' }
      const queryErr: any = new QueryFailedError('INSERT ...', [], driverErr)
      queryErr.driverError = driverErr
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
    it('查询时不返回 password 字段（通过 select 控制）', async () => {
      // M7：findAll 改用 findAndCount，返回 {list, total, page, pageSize}
      mockUserRepo.findAndCount.mockResolvedValueOnce([
        [{ id: 1, username: 'a', status: 1, createTime: 1 }],
        1,
      ])
      const result = await service.findAll(1, 20)
      expect(result.list).toHaveLength(1)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
      // 验证 findAndCount 调用时显式排除了 password 且不含 phone
      expect(mockUserRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            id: true, username: true, status: true, createTime: true,
          }),
        }),
      )
      const selectArg = mockUserRepo.findAndCount.mock.calls[0][0].select
      expect(selectArg).not.toHaveProperty('password')
      expect(selectArg).not.toHaveProperty('phone')
    })
  })

  describe('toggleStatus - 切换用户状态', () => {
    it('1 → 0 时调用 removeAll（禁用需吊销所有会话）', async () => {
      mockUserRepo.findOneBy.mockResolvedValueOnce({
        id: 1, username: 'alice', status: 1, phone: '1', createTime: 1,
      })
      mockUserRepo.save.mockResolvedValueOnce({ id: 1, status: 0 })

      const result = await service.toggleStatus(1)
      expect(result.status).toBe(0)
      expect(mockSessionService.removeAll).toHaveBeenCalledWith(1)
    })

    it('0 → 1 时不应调用 removeAll', async () => {
      mockUserRepo.findOneBy.mockResolvedValueOnce({
        id: 1, username: 'alice', status: 0, phone: '1', createTime: 1,
      })
      mockUserRepo.save.mockResolvedValueOnce({ id: 1, status: 1 })

      const result = await service.toggleStatus(1)
      expect(result.status).toBe(1)
      expect(mockSessionService.removeAll).not.toHaveBeenCalled()
    })

    it('用户不存在时抛 NotFoundException', async () => {
      mockUserRepo.findOneBy.mockResolvedValueOnce(null)
      await expect(service.toggleStatus(999)).rejects.toThrow(NotFoundException)
    })

    it('切换状态后应发审计事件', async () => {
      mockUserRepo.findOneBy.mockResolvedValueOnce({ id: 1, username: 'a', status: 1 })
      mockUserRepo.save.mockResolvedValueOnce({ id: 1, status: 0 })

      await service.toggleStatus(1)
      expect(mockEvents.emit).toHaveBeenCalledWith(
        AuditEvents.LOG,
        expect.objectContaining({
          action: 'toggle-status',
          ctx: expect.objectContaining({ status: 1 }),
        }),
      )
    })
  })
})
