/**
 * LoginThrottlerService 单元测试
 *
 * 测试目标：
 *  1. IP 维度滑动窗口限流：前 5 次通过，第 6 次拒绝
 *  2. 账号锁定：连续 5 次失败后锁定 15 分钟
 *  3. 锁定后查询剩余 TTL（>0 / ===0）
 *  4. 登录成功后清除失败计数和锁定标记
 *  5. setnx 只设置一次（避免刷新锁定 TTL）
 */

import { Test, TestingModule } from '@nestjs/testing'
import { LoginThrottlerService } from './login-throttler.service'
import { RedisService } from '../redis/redis.service'

// ========== RedisService Mock ==========
const redisStore = new Map<string, { value: string; expiresAt?: number }>()

const mockRedisService = {
  incr: jest.fn(async (key: string) => {
    const existing = redisStore.get(key)
    if (!existing) {
      redisStore.set(key, { value: '1' })
      return 1
    }
    existing.value = String(parseInt(existing.value, 10) + 1)
    return parseInt(existing.value, 10)
  }),
  expire: jest.fn(async (key: string, seconds: number) => {
    const entry = redisStore.get(key)
    if (!entry) return 0
    entry.expiresAt = Date.now() + seconds * 1000
    return 1
  }),
  ttl: jest.fn(async (key: string) => {
    const entry = redisStore.get(key)
    if (!entry) return -2
    if (!entry.expiresAt) return -1
    const remain = Math.ceil((entry.expiresAt - Date.now()) / 1000)
    return remain > 0 ? remain : -2
  }),
  setnx: jest.fn(async (key: string, value: string, ttl?: number) => {
    if (redisStore.has(key)) return 0
    redisStore.set(key, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : undefined })
    return 1
  }),
  del: jest.fn(async (key: string) => {
    const had = redisStore.has(key)
    redisStore.delete(key)
    return had ? 1 : 0
  }),
  set: jest.fn(async (key: string, value: string, ttl?: number) => {
    redisStore.set(key, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : undefined })
    return 'OK'
  }),
  exists: jest.fn(async (key: string) => (redisStore.has(key) ? 1 : 0)),
}

describe('LoginThrottlerService', () => {
  let service: LoginThrottlerService

  beforeEach(async () => {
    redisStore.clear()
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginThrottlerService,
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile()
    service = module.get(LoginThrottlerService)
  })

  describe('checkIp - IP 维度滑动窗口限流', () => {
    it('前 5 次都应该返回 true（未超限）', async () => {
      for (let i = 0; i < 5; i++) {
        const ok = await service.checkIp('1.2.3.4')
        expect(ok).toBe(true)
      }
    })

    it('第 6 次应返回 false（超限拒绝）', async () => {
      for (let i = 0; i < 5; i++) {
        await service.checkIp('1.2.3.4')
      }
      const ok = await service.checkIp('1.2.3.4')
      expect(ok).toBe(false)
    })

    it('不同 IP 的计数独立', async () => {
      for (let i = 0; i < 5; i++) {
        await service.checkIp('1.2.3.4')
      }
      // IP-A 已超限，IP-B 应该还能继续
      const okB = await service.checkIp('5.6.7.8')
      expect(okB).toBe(true)
    })

    it('第一次 incr 时应设置 TTL（窗口起点）', async () => {
      await service.checkIp('1.2.3.4')
      expect(mockRedisService.expire).toHaveBeenCalledWith('login:ip:1.2.3.4', 10)
    })
  })

  describe('recordFailure - 失败计数 + 锁定', () => {
    it('未达阈值时返回当前失败次数', async () => {
      const c1 = await service.recordFailure('alice')
      const c2 = await service.recordFailure('alice')
      const c3 = await service.recordFailure('alice')
      expect([c1, c2, c3]).toEqual([1, 2, 3])
    })

    it('连续失败达到阈值时返回 -1 并锁定账号', async () => {
      for (let i = 0; i < 4; i++) {
        await service.recordFailure('alice')
      }
      const result = await service.recordFailure('alice')
      expect(result).toBe(-1)
      // 验证 setnx 被调用，TTL 为 15 分钟
      expect(mockRedisService.setnx).toHaveBeenCalledWith(
        'login:locked:alice',
        '1',
        15 * 60,
      )
    })

    it('第一次失败时设置 15 分钟 TTL', async () => {
      await service.recordFailure('alice')
      expect(mockRedisService.expire).toHaveBeenCalledWith(
        'login:fail:alice',
        15 * 60,
      )
    })

    it('锁定后继续失败不应刷新 TTL（setnx 只生效一次）', async () => {
      // 触发锁定
      for (let i = 0; i < 5; i++) {
        await service.recordFailure('alice')
      }
      // 第 6 次失败，setnx 应返回 0（key 已存在）
      ;(mockRedisService.setnx as jest.Mock).mockClear()
      await service.recordFailure('alice')
      expect(mockRedisService.setnx).toHaveBeenCalledTimes(1)
      // 第二次 setnx 由于 key 已存在，redisStore 不会更新 expiresAt（mock 实现已模拟）
    })
  })

  describe('getLockRemaining - 查询锁定剩余时间', () => {
    it('未锁定时返回 0', async () => {
      const remain = await service.getLockRemaining('alice')
      expect(remain).toBe(0)
    })

    it('锁定后返回剩余秒数', async () => {
      for (let i = 0; i < 5; i++) {
        await service.recordFailure('alice')
      }
      const remain = await service.getLockRemaining('alice')
      // 剩余时间应该接近 15 分钟（900 秒）
      expect(remain).toBeGreaterThan(0)
      expect(remain).toBeLessThanOrEqual(15 * 60)
    })
  })

  describe('clearFailures - 登录成功后清除', () => {
    it('应并发删除失败计数和锁定标记', async () => {
      await service.recordFailure('alice')
      await service.recordFailure('alice')
      await service.clearFailures('alice')

      expect(mockRedisService.del).toHaveBeenCalledWith('login:fail:alice')
      expect(mockRedisService.del).toHaveBeenCalledWith('login:locked:alice')
    })
  })
})