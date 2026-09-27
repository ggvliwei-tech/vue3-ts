/**
 * SmsService 单元测试
 *
 * 核心回归用例（P0）：
 * verifyCode 必须限制连续失败次数。
 *
 * 6 位数字验证码只有 100 万种可能、有效期 5 分钟。修复前允许无限次尝试，
 * 配合「忘记密码」接口即可重置任意账号（含管理员）的密码 —— 完整账号接管链路。
 * 另外这里也锁住两个容易改错的细节：
 *  - 失败计数只在首次失败时设 TTL，否则每次续期会让手机号被永久锁死（自伤式 DoS）
 *  - sendCode 无论如何都不能把验证码回传给前端
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston'
import { SmsService } from './sms.service'
import { RedisService } from '../redis/redis.service'

const PHONE = '13800138000'
const CODE_KEY = `sms:code:${PHONE}`
const ATTEMPT_KEY = `sms:attempt:${PHONE}`
const CODE_TTL = 300

describe('SmsService', () => {
  let service: SmsService
  /** 控制 getClient().incr 的返回值（每日计数与失败计数共用） */
  let incrValue: number

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    expire: jest.fn(),
    getClient: jest.fn(),
  }
  const mockConfigService = { get: jest.fn() }
  const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(async () => {
    jest.clearAllMocks()
    incrValue = 1

    mockRedisService.getClient.mockReturnValue({
      incr: jest.fn(async () => incrValue),
    })
    mockRedisService.get.mockResolvedValue(null)
    mockConfigService.get.mockImplementation((key: string) =>
      key === 'NODE_ENV' ? 'development' : undefined,
    )

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: mockLogger },
      ],
    }).compile()

    service = module.get(SmsService)
  })

  describe('sendCode', () => {
    it('冷却期内重复发送应被拒绝', async () => {
      mockRedisService.get.mockImplementation(async (key: string) =>
        key.startsWith('sms:limit:') ? '42' : null,
      )

      await expect(service.sendCode(PHONE)).rejects.toThrow(
        /发送过于频繁.*42 秒/,
      )
    })

    it('达到每日发送上限应被拒绝', async () => {
      mockRedisService.get.mockImplementation(async (key: string) =>
        key.startsWith('sms:count:') ? '10' : null,
      )

      await expect(service.sendCode(PHONE)).rejects.toThrow(/今日发送次数已达上限/)
    })

    it('即使 Mock 模式也不能把验证码回传给调用方', async () => {
      const result = await service.sendCode(PHONE)

      expect(result).toEqual({ msg: expect.any(String) })
      expect(result).not.toHaveProperty('code')
      expect(result).not.toHaveProperty('mockCode')
      // 验证码只应进 Redis 与日志
      expect(mockRedisService.set).toHaveBeenCalledWith(
        CODE_KEY,
        expect.stringMatching(/^\d{6}$/),
        CODE_TTL,
      )
      expect(mockLogger.log).toHaveBeenCalled()
    })

    it('生成的验证码为 6 位数字（crypto.randomInt，非 Math.random）', async () => {
      await service.sendCode(PHONE)

      const [, code] = mockRedisService.set.mock.calls[0]
      expect(code).toMatch(/^[1-9]\d{5}$/)
    })

    it('生产环境不应走 Mock 分支', async () => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'NODE_ENV' ? 'production' : undefined,
      )

      // 真实通道未接入，应抛出 SDK 未安装的错误而不是静默走 Mock
      await expect(service.sendCode(PHONE)).rejects.toThrow(/阿里云短信 SDK/)
    })
  })

  describe('verifyCode', () => {
    it('验证码不存在（未发送 / 已过期 / 已作废）时返回 false', async () => {
      mockRedisService.get.mockResolvedValue(null)

      await expect(service.verifyCode(PHONE, '123456')).resolves.toBe(false)
    })

    it('校验通过返回 true，并清除验证码与失败计数', async () => {
      mockRedisService.get.mockResolvedValue('123456')

      await expect(service.verifyCode(PHONE, '123456')).resolves.toBe(true)
      expect(mockRedisService.del).toHaveBeenCalledWith(CODE_KEY, ATTEMPT_KEY)
    })

    it('校验失败返回 false，且首次失败会设置计数 TTL', async () => {
      mockRedisService.get.mockResolvedValue('123456')
      incrValue = 1

      await expect(service.verifyCode(PHONE, '000000')).resolves.toBe(false)
      expect(mockRedisService.expire).toHaveBeenCalledWith(
        ATTEMPT_KEY,
        CODE_TTL,
      )
      // 失败一次不能作废验证码，用户仍有重试机会
      expect(mockRedisService.del).not.toHaveBeenCalled()
    })

    it('后续失败不再续期 TTL（否则手机号会被永久锁死）', async () => {
      mockRedisService.get.mockResolvedValue('123456')
      incrValue = 2

      await expect(service.verifyCode(PHONE, '000000')).resolves.toBe(false)
      expect(mockRedisService.expire).not.toHaveBeenCalled()
    })

    it('连续失败 5 次后作废验证码，攻击者必须重新发送', async () => {
      mockRedisService.get.mockResolvedValue('123456')
      incrValue = 5

      await expect(service.verifyCode(PHONE, '000000')).resolves.toBe(false)
      expect(mockRedisService.del).toHaveBeenCalledWith(CODE_KEY, ATTEMPT_KEY)
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('第 6 次尝试时验证码已被删除，直接返回 false', async () => {
      // 模拟第 5 次失败后 code 与 attempt 均被清空
      mockRedisService.get.mockResolvedValue(null)

      await expect(service.verifyCode(PHONE, '000000')).resolves.toBe(false)
    })
  })
})
