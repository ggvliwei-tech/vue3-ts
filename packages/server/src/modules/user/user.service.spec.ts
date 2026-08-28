/**
 * UserService 关键路径单元测试
 *
 * 测试目标（聚焦核心业务逻辑，跳过依赖较深的 login 流程）：
 *  1. create - 用户名重复抛 ConflictException
 *  2. create - 手机号重复抛 ConflictException
 *  3. create - 密码应被 bcrypt 哈希（不存明文）
 *  4. create - 数据库唯一约束冲突（1062）兜底
 *  5. findById - 不存在时抛 NotFoundException
 *  6. findById - 应返回角色和权限码
 *  7. findAll - 不返回 password 字段
 *  8. toggleStatus - 状态在 0/1 间切换，禁用时调用 removeAll
 *  9. forceKick - 踢全部设备时清缓存 + removeAll
 *  10. forceKick - 踢指定设备时仅 remove 单 session
 */

import { Test, TestingModule } from '@nestjs/testing'
import { UserService } from './user.service'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { getRepositoryToken } from '@nestjs/typeorm'
import { User } from './entities/user.entity'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { RedisService } from '../redis/redis.service'
import { SmsService } from '../sms/sms.service'
import { RbacService } from '../rbac/rbac.service'
import { LoginThrottlerService } from '../auth/login-throttler.service'
import { SessionService } from '../auth/session.service'
import { AuditService } from '../audit/audit.service'
import * as bcrypt from 'bcrypt'
import { QueryFailedError } from 'typeorm'

// ========== Mock Repositories ==========
const mockUserRepo = {
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  find: jest.fn(),
  create: jest.fn((dto) => dto),
  save: jest.fn(async (user) => ({ id: 1, ...user })),
}

const mockConfig = {
  getOrThrow: jest.fn((key: string) => {
    const map: Record<string, string> = {
      JWT_ACCESS_SECRET: 'access-secret-test',
      JWT_REFRESH_SECRET: 'refresh-secret-test',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    }
    return map[key] || 'default'
  }),
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

const mockAudit = {
  log: jest.fn(),
}

describe('UserService', () => {
  let service: UserService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: JwtService, useValue: { sign: jest.fn(() => 'signed-token') } },
        { provide: ConfigService, useValue: mockConfig },
        { provide: RedisService, useValue: {} },
        { provide: SmsService, useValue: {} },
        { provide: RbacService, useValue: mockRbacService },
        { provide: LoginThrottlerService, useValue: {} },
        { provide: SessionService, useValue: mockSessionService },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile()
    service = module.get(UserService)
  })

  // ========== create 注册流程 ==========
  describe('create - 注册', () => {
    const dto = { username: 'newuser', password: 'rawPwd123', phone: '13800138000' }

    it('用户名重复时抛 ConflictException', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({ id: 99, username: 'newuser' })
      await expect(service.create(dto as any)).rejects.toThrow(ConflictException)
    })

    it('手机号重复时抛 ConflictException', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce(null) // username 没冲突
      mockUserRepo.findOne.mockResolvedValueOnce({ id: 99, phone: '13800138000' }) // phone 冲突
      await expect(service.create(dto as any)).rejects.toThrow(ConflictException)
    })

    it('密码应被 bcrypt 哈希（不存明文）', async () => {
      mockUserRepo.findOne.mockResolvedValue(null)
      mockUserRepo.create.mockImplementation((data) => data)
      mockUserRepo.save.mockImplementation(async (u) => ({ id: 1, ...u }))

      await service.create(dto as any)

      // 验证传给 save 的对象中 password 不是明文
      const saveCall = mockUserRepo.save.mock.calls[0][0]
      expect(saveCall.password).not.toBe(dto.password)
      expect(saveCall.password).toMatch(/^\$2[aby]\$/) // bcrypt 哈希特征前缀
      // 验证可被 bcrypt 验回明文
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

  // ========== findById ==========
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

  // ========== findAll ==========
  describe('findAll', () => {
    it('查询时不返回 password 字段（通过 select 控制）', async () => {
      mockUserRepo.find.mockResolvedValueOnce([
        { id: 1, username: 'a', phone: '1', status: 1, createTime: 1 },
      ])
      await service.findAll()
      // 验证调用 find 时显式排除了 password
      expect(mockUserRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            id: true, username: true, phone: true, status: true, createTime: true,
          }),
        }),
      )
      const selectArg = mockUserRepo.find.mock.calls[0][0].select
      expect(selectArg).not.toHaveProperty('password')
    })
  })

  // ========== toggleStatus 状态切换 ==========
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
  })

  // ========== forceKick 强制下线 ==========
  describe('forceKick - 强制下线', () => {
    it('不传 sessionId 时踢全部设备 + 清缓存', async () => {
      mockUserRepo.findOneBy.mockResolvedValueOnce({
        id: 1, username: 'alice', status: 1,
      })

      const result = await service.forceKick(1)
      expect(result.msg).toContain('全设备下线')
      expect(mockSessionService.removeAll).toHaveBeenCalledWith(1)
      expect(mockRbacService.clearUserCache).toHaveBeenCalledWith(1)
    })

    it('传 sessionId 时仅踢指定设备', async () => {
      mockUserRepo.findOneBy.mockResolvedValueOnce({
        id: 1, username: 'alice', status: 1,
      })

      const result = await service.forceKick(1, 'session-abc')
      expect(result.msg).toContain('session-abc')
      expect(mockSessionService.remove).toHaveBeenCalledWith(1, 'session-abc')
      expect(mockSessionService.removeAll).not.toHaveBeenCalled()
      // 踢单个不需 clearUserCache
      expect(mockRbacService.clearUserCache).not.toHaveBeenCalled()
    })

    it('用户不存在时抛 NotFoundException', async () => {
      mockUserRepo.findOneBy.mockResolvedValueOnce(null)
      await expect(service.forceKick(999)).rejects.toThrow(NotFoundException)
    })
  })

  // ========== 审计日志 ==========
  describe('审计日志记录', () => {
    it('toggleStatus 应记录审计', async () => {
      mockUserRepo.findOneBy.mockResolvedValueOnce({ id: 1, username: 'a', status: 1 })
      mockUserRepo.save.mockResolvedValueOnce({ id: 1, status: 0 })

      await service.toggleStatus(1)
      expect(mockAudit.log).toHaveBeenCalledWith('toggle-status', expect.objectContaining({ status: 1 }))
    })

    it('forceKick 应记录审计', async () => {
      mockUserRepo.findOneBy.mockResolvedValueOnce({ id: 1, username: 'a', status: 1 })

      await service.forceKick(1)
      expect(mockAudit.log).toHaveBeenCalledWith('kick', expect.objectContaining({ status: 1 }))
    })
  })
})