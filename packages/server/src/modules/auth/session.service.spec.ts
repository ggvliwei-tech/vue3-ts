/**
 * SessionService 单元测试
 *
 * 测试目标：
 *  1. create / get / update / remove 基础 CRUD 正常路径
 *  2. listSessions 按 loginTime 倒序，损坏数据容错
 *  3. removeAll 清空所有 RT + 设置黑名单
 *  4. isBlacklisted 检测黑名单存在性
 *  5. UUID 格式校验（newSessionId）
 */

import { Test, TestingModule } from '@nestjs/testing'
import { SessionService, SessionInfo } from './session.service'
import { RedisService } from '../redis/redis.service'

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
    it('应并发删除 RT 和 Hash 字段', async () => {
      redisStore.set('refresh:token:1:sess-1', { value: 'rt' })
      const hash = new Map<string, string>([['sess-1', 'json']])
      redisHashStore.set('session:1', hash)

      await service.remove(1, 'sess-1')

      expect(mockRedisService.del).toHaveBeenCalledWith('refresh:token:1:sess-1')
      expect(mockRedisService.hdel).toHaveBeenCalledWith('session:1', 'sess-1')
    })
  })

  describe('removeAll - 清空全部 + 黑名单', () => {
    it('应删除所有 RT + Hash + 设置 900s 黑名单', async () => {
      const hash = new Map<string, string>([
        ['sess-1', JSON.stringify({ sessionId: 'sess-1', loginTime: 1, ip: 'a', userAgent: 'ua' })],
        ['sess-2', JSON.stringify({ sessionId: 'sess-2', loginTime: 2, ip: 'b', userAgent: 'ub' })],
      ])
      redisHashStore.set('session:1', hash)

      await service.removeAll(1)

      // 黑名单已设置
      expect(redisStore.has('blacklist:token:1')).toBe(true)
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'blacklist:token:1',
        '1',
        900,
      )
    })

    it('默认黑名单 TTL 为 900 秒', async () => {
      await service.removeAll(1)
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'blacklist:token:1',
        '1',
        900,
      )
    })

    it('允许自定义黑名单 TTL', async () => {
      await service.removeAll(1, 1800)
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'blacklist:token:1',
        '1',
        1800,
      )
    })
  })

  describe('isBlacklisted - 黑名单检查', () => {
    it('黑名单存在时返回 true', async () => {
      redisStore.set('blacklist:token:5', { value: '1' })
      expect(await service.isBlacklisted(5)).toBe(true)
    })

    it('黑名单不存在时返回 false', async () => {
      expect(await service.isBlacklisted(999)).toBe(false)
    })
  })
})