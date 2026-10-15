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
    // 冷却位改用 SET NX（原子），配套的 setnx / ttl 两个方法
    setnx: jest.fn(),
    ttl: jest.fn(),
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
    // 默认抢到冷却位（未处于冷却期）
    mockRedisService.setnx.mockResolvedValue(1)
    mockRedisService.ttl.mockResolvedValue(-1)
    mockRedisService.del.mockResolvedValue(1)
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
      // 抢不到冷却位（SET NX 返回 0），剩余 42 秒
      mockRedisService.setnx.mockResolvedValue(0)
      mockRedisService.ttl.mockResolvedValue(42)

      await expect(service.sendCode(PHONE)).rejects.toThrow(
        /发送过于频繁.*42 秒/,
      )
    })

    it('冷却判定用 SET NX 原子完成，不是先 get 再 set（否则并发即可绕过）', async () => {
      await service.sendCode(PHONE)

      // 判断与占位必须是同一次调用，中间不能有 get → set 的窗口
      expect(mockRedisService.setnx).toHaveBeenCalledWith(
        `sms:limit:${PHONE}`,
        '1',
        60,
      )
      expect(mockRedisService.get).not.toHaveBeenCalledWith(`sms:limit:${PHONE}`)
    })

    it('达到每日发送上限应被拒绝', async () => {
      // 原子自增后返回值超过上限（第 11 次）
      incrValue = 11

      await expect(service.sendCode(PHONE)).rejects.toThrow(/今日发送次数已达上限/)
    })

    it('发送失败时释放冷却位（否则用户要为一次没发出去的请求白等 60 秒）', async () => {
      // 真实通道未接入 → sendViaAliyun 抛 503
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production'
        return undefined
      })

      await expect(service.sendCode(PHONE)).rejects.toThrow(/短信服务暂不可用/)
      expect(mockRedisService.del).toHaveBeenCalledWith(`sms:limit:${PHONE}`)
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

  })

  describe('sendCode - Mock 开关（生产默认关闭）', () => {
    /**
     * 设定 NODE_ENV / SMS_MOCK 两个配置项
     */
    const setEnv = (nodeEnv: string, smsMock: string | undefined) => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return nodeEnv
        if (key === 'SMS_MOCK') return smsMock
        return undefined
      })
    }

    it('生产环境未设 SMS_MOCK 时走真实通道（未接入 → 503，而不是静默 mock）', async () => {
      setEnv('production', undefined)

      // 文案必须面向终端用户，不能把「请先 npm install」这类实现细节抛给前端
      await expect(service.sendCode(PHONE)).rejects.toThrow(
        /短信服务暂不可用，请稍后重试或联系管理员/,
      )
      // 运维侧要能从日志看出根因和两条出路
      expect(mockLogger.error).toHaveBeenCalled()
      // 真实通道不会把验证码打进 info 日志
      expect(mockLogger.log).not.toHaveBeenCalled()
    })

    it('生产环境 SMS_MOCK 为其他真值字符串时仍走真实通道（严格判定 true）', async () => {
      setEnv('production', '1')

      await expect(service.sendCode(PHONE)).rejects.toThrow(/短信服务暂不可用/)
    })

    it('生产环境 SMS_MOCK=true 时才允许走 mock（私有部署应急开关）', async () => {
      setEnv('production', 'true')

      await expect(service.sendCode(PHONE)).resolves.toEqual({
        msg: '验证码已发送',
      })
      expect(mockLogger.log).toHaveBeenCalled()
    })

    it('staging 与 production 同策略', async () => {
      setEnv('staging', undefined)
      await expect(service.sendCode(PHONE)).rejects.toThrow(/短信服务暂不可用/)

      setEnv('staging', 'true')
      await expect(service.sendCode(PHONE)).resolves.toEqual({
        msg: '验证码已发送',
      })
    })

    it('开发环境默认走 mock（无需设任何变量）', async () => {
      setEnv('development', undefined)

      await expect(service.sendCode(PHONE)).resolves.toEqual({
        msg: '验证码已发送',
      })
      expect(mockLogger.log).toHaveBeenCalled()
    })

    it('开发环境 SMS_MOCK=false 时走真实通道（可提前验证 503 提示）', async () => {
      setEnv('development', 'false')

      await expect(service.sendCode(PHONE)).rejects.toThrow(/短信服务暂不可用/)
    })

    it('生产环境开着 mock 时启动期必须告警（否则只等用户报"收不到验证码"）', () => {
      setEnv('production', 'true')
      service.onModuleInit()

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Mock 短信通道') }),
      )
    })

    it('开发环境走 mock 不告警（这是预期行为，不该刷日志）', () => {
      setEnv('development', undefined)
      service.onModuleInit()

      expect(mockLogger.warn).not.toHaveBeenCalled()
    })
  })

  describe('日配额按配置时区切天（不是 UTC）', () => {
    afterEach(() => {
      jest.useRealTimers()
    })

    /**
     * 回归：日配额 key 里的日期必须按 SMS_DAILY_TZ（默认 Asia/Shanghai）算，
     * 不能是 UTC 日期。
     *
     * 后端容器默认没有设 TZ（compose 里只给 mysql 设了），进程时区就是 UTC。
     * 用 toISOString() 取日期的话，国内用户的"今天"会在每天早上 08:00 翻篇 ——
     * 用户上午会莫名重获 10 次配额，而文案写的是"今日…请明天再试"。
     */
    it('UTC 与东八区跨天时，取东八区的日期', async () => {
      // 2026-10-15T20:00:00Z = 北京时间 2026-10-16 04:00
      jest.useFakeTimers().setSystemTime(new Date('2026-10-15T20:00:00Z'))

      await service.sendCode(PHONE)

      const incrKey = mockRedisService.getClient().incr.mock.calls[0][0]
      expect(incrKey).toBe(`sms:count:${PHONE}:2026-10-16`)
      expect(incrKey).not.toBe(`sms:count:${PHONE}:2026-10-15`)
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
