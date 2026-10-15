/**
 * SessionService 单元测试
 *
 * 测试目标：
 *  1. create / get / update / remove 基础 CRUD 正常路径
 *  2. listSessions 按 loginTime 倒序，损坏数据容错
 *  3. remove 同时拉黑该设备（access token 立即失效）
 *  4. removeAll 清空所有 RT + 递增用户令牌版本号（全部设备的 access token 失效）
 *  5. 两种吊销粒度互不干扰：设备级只影响那一台，用户级版本号影响全部
 *  6. 设备级黑名单 TTL 对齐 access token 有效期（不能短于它）
 *  7. 令牌版本号单调递增，且不因后续登录被重置（回归：旧实现会复活旧令牌）
 *  7. UUID 格式校验（newSessionId）
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { SessionService, SessionInfo } from './session.service'
import { RedisService } from '../redis/redis.service'
import { isTokenRevoked } from '../../common/utils/token-version.util'

// access token 有效期 30m = 1800s，黑名单 TTL 必须与它对齐
const ACCESS_TOKEN_TTL_SECONDS = 1800

// ========== ConfigService Mock ==========
const mockConfigService = {
  getOrThrow: jest.fn((key: string) => {
    if (key === 'JWT_ACCESS_EXPIRES_IN') return '30m'
    throw new Error(`测试未 mock 的配置项：${key}`)
  }),
}

// ========== RedisService Mock ==========
const redisStore = new Map<string, { value: string; expiresAt?: number }>()
const redisHashStore = new Map<string, Map<string, string>>()

const mockRedisService = {
  set: jest.fn(async (key: string, value: string, ttl?: number) => {
    redisStore.set(key, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : undefined })
    return 'OK'
  }),
  get: jest.fn(async (key: string) => {
    return redisStore.get(key)?.value ?? null
  }),
  del: jest.fn(async (key: string) => {
    const had = redisStore.has(key)
    redisStore.delete(key)
    redisHashStore.delete(key) // hash 也算 key 空间
    return had ? 1 : 0
  }),
  exists: jest.fn(async (key: string) => {
    return redisStore.has(key) || redisHashStore.has(key) ? 1 : 0
  }),
  expire: jest.fn(async (key: string, seconds: number) => {
    const entry = redisStore.get(key)
    if (entry) {
      entry.expiresAt = Date.now() + seconds * 1000
      return 1
    }
    return 0
  }),
  hset: jest.fn(async (key: string, field: string, value: string) => {
    let hash = redisHashStore.get(key)
    if (!hash) {
      hash = new Map()
      redisHashStore.set(key, hash)
    }
    const existed = hash.has(field) ? 1 : 0
    hash.set(field, value)
    return existed === 1 ? 0 : 1
  }),
  hget: jest.fn(async (key: string, field: string) => {
    return redisHashStore.get(key)?.get(field) ?? null
  }),
  hgetall: jest.fn(async (key: string) => {
    const hash = redisHashStore.get(key)
    if (!hash) return {}
    const result: Record<string, string> = {}
    hash.forEach((v, k) => (result[k] = v))
    return result
  }),
  hdel: jest.fn(async (key: string, ...fields: string[]) => {
    const hash = redisHashStore.get(key)
    if (!hash) return 0
    let count = 0
    for (const f of fields) {
      if (hash.delete(f)) count++
    }
    return count
  }),
  // 真实 Redis 的 INCR 会保留已有 TTL，这里一并模拟，避免误以为版本号会过期
  incr: jest.fn(async (key: string) => {
    const entry = redisStore.get(key)
    const current = parseInt(entry?.value ?? '0', 10)
    const next = (Number.isFinite(current) ? current : 0) + 1
    redisStore.set(key, { value: String(next), expiresAt: entry?.expiresAt })
    return next
  }),
}

describe('SessionService', () => {
  let service: SessionService

  beforeEach(async () => {
    redisStore.clear()
    redisHashStore.clear()
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: RedisService, useValue: mockRedisService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile()
    service = module.get(SessionService)
  })

  describe('newSessionId', () => {
    it('应返回合法的 UUID v4 字符串', () => {
      const id = service.newSessionId()
      // UUID v4 正则
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
    })

    it('每次调用都应返回不同的 ID', () => {
      const ids = new Set(Array.from({ length: 10 }, () => service.newSessionId()))
      expect(ids.size).toBe(10)
    })
  })

  describe('create - 创建会话', () => {
    it('应同时写入 RT 和会话元数据', async () => {
      const userId = 1
      const sessionId = service.newSessionId()
      const meta = { ip: '1.2.3.4', userAgent: 'Chrome/120' }
      await service.create(userId, sessionId, 'rt-token', meta, 7200)

      // 1. RT 已存入
      expect(mockRedisService.set).toHaveBeenCalledWith(
        `refresh:token:${userId}:${sessionId}`,
        'rt-token',
        7200,
      )
      // 2. 会话元数据写入 Hash
      expect(mockRedisService.hset).toHaveBeenCalledWith(
        `session:${userId}`,
        sessionId,
        expect.stringContaining(sessionId),
      )
      // 3. Hash 也设置了 TTL
      expect(mockRedisService.expire).toHaveBeenCalledWith(`session:${userId}`, 7200)
    })

    it('会话元数据应包含 loginTime/ip/userAgent', async () => {
      const userId = 2
      const sessionId = 'sess-abc'
      const before = Date.now()
      await service.create(userId, sessionId, 'rt', { ip: '5.6.7.8', userAgent: 'Safari' }, 3600)
      const after = Date.now()

      const hsetCall = (mockRedisService.hset as jest.Mock).mock.calls[0]
      const stored: SessionInfo = JSON.parse(hsetCall[2])
      expect(stored.sessionId).toBe(sessionId)
      expect(stored.ip).toBe('5.6.7.8')
      expect(stored.userAgent).toBe('Safari')
      expect(stored.loginTime).toBeGreaterThanOrEqual(before)
      expect(stored.loginTime).toBeLessThanOrEqual(after)
    })
  })

  describe('getRefreshToken - 读取 RT', () => {
    it('存在时返回 RT', async () => {
      redisStore.set('refresh:token:1:sess-1', { value: 'rt-abc' })
      const rt = await service.getRefreshToken(1, 'sess-1')
      expect(rt).toBe('rt-abc')
    })

    it('不存在时返回 null', async () => {
      const rt = await service.getRefreshToken(1, 'not-exist')
      expect(rt).toBeNull()
    })
  })

  describe('updateRefreshToken - 轮换 RT', () => {
    it('应覆盖旧 RT 并设置新 TTL', async () => {
      redisStore.set('refresh:token:1:sess-1', { value: 'rt-old' })
      await service.updateRefreshToken(1, 'sess-1', 'rt-new', 3600)
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'refresh:token:1:sess-1',
        'rt-new',
        3600,
      )
    })
  })

  describe('listSessions - 列出所有会话', () => {
    it('应按 loginTime 倒序返回', async () => {
      const hash = new Map<string, string>()
      hash.set('sess-old', JSON.stringify({ sessionId: 'sess-old', loginTime: 1000, ip: 'a', userAgent: 'ua1' }))
      hash.set('sess-new', JSON.stringify({ sessionId: 'sess-new', loginTime: 3000, ip: 'b', userAgent: 'ua2' }))
      hash.set('sess-mid', JSON.stringify({ sessionId: 'sess-mid', loginTime: 2000, ip: 'c', userAgent: 'ua3' }))
      redisHashStore.set('session:1', hash)

      const list = await service.listSessions(1)
      expect(list.map((s) => s.sessionId)).toEqual(['sess-new', 'sess-mid', 'sess-old'])
    })

    it('损坏数据应被跳过，不影响其他会话', async () => {
      const hash = new Map<string, string>()
      hash.set('sess-ok', JSON.stringify({ sessionId: 'sess-ok', loginTime: 2000, ip: 'a', userAgent: 'ua' }))
      hash.set('sess-corrupt', '{not-a-valid-json')
      redisHashStore.set('session:1', hash)

      const list = await service.listSessions(1)
      expect(list).toHaveLength(1)
      expect(list[0].sessionId).toBe('sess-ok')
    })

    it('空会话应返回空数组', async () => {
      const list = await service.listSessions(999)
      expect(list).toEqual([])
    })
  })

  describe('remove - 删除单个会话', () => {
    it('应并发删除 RT、Hash 字段，并拉黑该设备', async () => {
      redisStore.set('refresh:token:1:sess-1', { value: 'rt' })
      const hash = new Map<string, string>([['sess-1', 'json']])
      redisHashStore.set('session:1', hash)

      await service.remove(1, 'sess-1')

      expect(mockRedisService.del).toHaveBeenCalledWith('refresh:token:1:sess-1')
      expect(mockRedisService.hdel).toHaveBeenCalledWith('session:1', 'sess-1')
      // 只删 RT 是不够的：access token 自包含，不拉黑的话剩余有效期内仍可用
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'blacklist:session:1:sess-1',
        '1',
        ACCESS_TOKEN_TTL_SECONDS,
      )
    })
  })

  describe('removeAll - 清空全部 + 递增令牌版本号', () => {
    it('应删除所有 RT + Hash，并递增用户令牌版本号', async () => {
      const hash = new Map<string, string>([
        ['sess-1', JSON.stringify({ sessionId: 'sess-1', loginTime: 1, ip: 'a', userAgent: 'ua' })],
        ['sess-2', JSON.stringify({ sessionId: 'sess-2', loginTime: 2, ip: 'b', userAgent: 'ub' })],
      ])
      redisHashStore.set('session:1', hash)

      await service.removeAll(1)

      // 两个设备的 RT 都被清掉
      expect(mockRedisService.del).toHaveBeenCalledWith('refresh:token:1:sess-1')
      expect(mockRedisService.del).toHaveBeenCalledWith('refresh:token:1:sess-2')
      expect(mockRedisService.del).toHaveBeenCalledWith('session:1')
      // 版本号 0 → 1：此前签发的 access token 全部失效
      expect(mockRedisService.incr).toHaveBeenCalledWith('auth:ver:1')
      expect(await service.getTokenVersion(1)).toBe(1)
    })

    it('版本号必须单调递增，且不设 TTL（过期归零会让比较失效）', async () => {
      await service.removeAll(1)
      await service.removeAll(1)

      expect(await service.getTokenVersion(1)).toBe(2)
      expect(redisStore.get('auth:ver:1')?.expiresAt).toBeUndefined()
    })

    it('回归：踢全部设备后，旧令牌不会因为用户重新登录而复活', async () => {
      // 旧实现把「用户级黑名单」做成一个布尔开关，而登录成功必须删掉它
      // （否则刚签发的新令牌也被拦下），删除的瞬间旧令牌全部复活。
      // 版本号方案没有这个开关：登录只是把当前版本号写进新令牌，
      // 旧令牌带的版本 < 当前版本，依然被拒。
      const currentVersionBeforeKick = await service.getTokenVersion(1)
      await service.removeAll(1) // 管理员踢掉该用户全部设备
      const currentVersionAfterKick = await service.getTokenVersion(1)

      // 踢下线之前的令牌：版本号比当前小 → 应判定为已吊销
      expect(
        isTokenRevoked(currentVersionBeforeKick, currentVersionAfterKick),
      ).toBe(true)
      // 重新登录后签发的令牌：版本号等于当前值 → 放行
      expect(isTokenRevoked(currentVersionAfterKick, currentVersionAfterKick)).toBe(false)
      // 关键：登录不清任何东西，版本号仍停在踢下线后的值
      expect(currentVersionAfterKick).toBe(currentVersionBeforeKick + 1)
    })

    it('从未被踢过的用户，版本号读出 0', async () => {
      expect(await service.getTokenVersion(1)).toBe(0)
      expect(redisStore.has('auth:ver:1')).toBe(false)
    })

    it('版本号被外部写脏时退回 0（fail-open，而非把用户锁死）', async () => {
      redisStore.set('auth:ver:1', { value: 'not-a-number' })
      expect(await service.getTokenVersion(1)).toBe(0)
    })
  })

  describe('blacklistSession - 设备级黑名单', () => {
    it('应写入设备级黑名单，TTL 对齐 access token 有效期', async () => {
      await service.blacklistSession(1, 'sess-1')
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'blacklist:session:1:sess-1',
        '1',
        ACCESS_TOKEN_TTL_SECONDS,
      )
    })

    it('只影响被拉黑的那台设备，同用户其他设备不受波及', async () => {
      await service.blacklistSession(1, 'sess-1')

      expect(redisStore.has('blacklist:session:1:sess-1')).toBe(true)
      expect(redisStore.has('blacklist:session:1:sess-2')).toBe(false)
      // 设备级拉黑不应连带触发用户级吊销（否则"多设备互不影响"就失效了）
      expect(mockRedisService.incr).not.toHaveBeenCalled()
    })
  })
})