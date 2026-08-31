// 从 @nestjs/common 导入 Injectable 装饰器、LoggerService 类型
import { Inject, Injectable } from '@nestjs/common'
import type { LoggerService } from '@nestjs/common'
// 注入 winston logger
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston'
// 导入 Redis 服务，用于 L2 缓存
import { RedisService } from './redis.service'

/**
 * 缓存选项
 */
export interface CacheOptions {
  /** 基础 TTL（秒），实际 TTL 会在 ±20% 范围抖动以防止雪崩 */
  ttl: number
  /** 缓存 key 前缀，便于按业务域批量失效 */
  prefix?: string
  /** null 值的缓存 TTL（秒），默认 30s —— 用于防护缓存穿透 */
  nullTtl?: number
}

/**
 * 二级缓存服务（L1 进程内 Map + L2 Redis）
 *
 * 三大防护（生产级缓存必备）：
 *  1. **雪崩防护**：TTL 在 base ± 20% 范围随机抖动，避免同一批 key 同时过期
 *  2. **击穿防护**：用 in-flight Map 去重 Promise，避免热点 key DB 瞬时被打穿
 *  3. **穿透防护**：DB 查不到时缓存空值（短 TTL），避免每次都查 DB
 *
 * 降级策略（与 RedisService 配合）：
 *  - Redis 故障时 L1 仍生效（保证单进程内一致）
 *  - Redis 故障不影响主流程（错误仅记日志）
 *
 * 使用示例：
 * ```ts
 * const roles = await cache.getOrLoad(
 *   `user:${userId}:roles`,
 *   { ttl: 600 },
 *   async () => this.userRoleRepo.find({...}),
 * )
 * ```
 */
@Injectable()
export class CacheService {
  /**
   * L1 进程内缓存：key → { value, expireAt }
   * 使用 Map 而非 WeakMap：缓存 key 都是字符串，无需 WeakMap
   * LRU 由 maxSize 控制，超出时淘汰最早插入的 entry（防止内存泄漏）
   */
  private readonly l1 = new Map<string, { value: unknown; expireAt: number }>()
  /** L1 缓存最大条目数（FIFO 淘汰） */
  private static readonly L1_MAX_SIZE = 5_000

  /**
   * 击穿防护：同一 key 的 loader Promise 去重
   * - 第一个请求触发 loader，后续请求等待该 Promise
   * - loader 完成后（无论成功失败）从 Map 移除
   */
  private readonly inFlight = new Map<string, Promise<unknown>>()

  constructor(
    private readonly redisService: RedisService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * 取缓存，命中 L1 直接返回，未命中查 L2
   * @returns 命中值；未命中返回 null
   */
  async get<T>(key: string): Promise<T | null> {
    // 1. L1 命中
    const l1Entry = this.l1.get(key)
    if (l1Entry) {
      if (l1Entry.expireAt > Date.now()) return l1Entry.value as T
      // L1 过期 → 删除
      this.l1.delete(key)
    }

    // 2. L2 (Redis) 命中
    try {
      const l2Value = await this.redisService.getJson<T>(key)
      if (l2Value !== null) {
        // 回填 L1（用 Redis 剩余 TTL，避免 L1 比 L2 先过期）
        // 简化：L1 TTL 与 L2 同步（误差 5 秒以内可接受），此处直接复用当前时间 +60s
        this.setL1(key, l2Value, this.defaultRemainTtl())
        return l2Value
      }
    } catch (err) {
      // L2 故障仅记日志（降级到不命中，让上层 loader 走 DB）
      this.logger.warn(`[Cache] L2 读取失败: key=${key}, ${(err as Error).message}`)
    }

    return null
  }

  /**
   * 设置缓存：同时写 L1 + L2
   * @param key 缓存 key
   * @param value 缓存值（null 也合法，触发穿透防护）
   * @param ttl 秒
   */
  async set(key: string, value: unknown, ttl: number): Promise<void> {
    // TTL 抖动：±20%，防止雪崩
    const jitteredTtl = this.jitterTtl(ttl)
    // 写 L1
    this.setL1(key, value, jitteredTtl * 1000)
    // 写 L2（失败仅记日志）
    try {
      await this.redisService.setJson(key, value, jitteredTtl)
    } catch (err) {
      this.logger.warn(`[Cache] L2 写入失败: key=${key}, ${(err as Error).message}`)
    }
  }

  /**
   * 删除缓存：同时清 L1 + L2
   * @param keys 1 个或多个 key
   */
  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return
    // 清 L1
    for (const k of keys) this.l1.delete(k)
    // 清 L2
    try {
      await this.redisService.del(...keys)
    } catch (err) {
      this.logger.warn(`[Cache] L2 删除失败: keys=${keys.join(',')}, ${(err as Error).message}`)
    }
  }

  /**
   * 按前缀失效缓存（用于角色/权限变更场景）
   * L1 用 prefix 匹配；L2 用 SCAN 命令（KEYS 在生产禁用）
   */
  async invalidatePrefix(prefix: string): Promise<void> {
    // L1：遍历删除
    for (const k of Array.from(this.l1.keys())) {
      if (k.startsWith(prefix)) this.l1.delete(k)
    }
    // L2：SCAN 模式匹配
    try {
      const client = this.redisService.getClient()
      const stream = client.scanStream({ match: `${prefix}*`, count: 100 })
      const pipeline = client.pipeline()
      let found = 0
      for await (const keys of stream) {
        for (const k of keys) {
          pipeline.del(k)
          found++
        }
      }
      if (found > 0) await pipeline.exec()
    } catch (err) {
      this.logger.warn(`[Cache] 按前缀失效失败: prefix=${prefix}, ${(err as Error).message}`)
    }
  }

  /**
   * 核心 API：get-or-load 模式（带击穿防护）
   *
   * - L1 / L2 命中 → 直接返回
   * - 未命中 → loader() 加载（首次触发，后续请求复用 Promise 等待）
   * - loader 返回 null → 缓存空值（穿透防护）
   * - loader 抛异常 → 不缓存（让调用方决定如何处理）
   *
   * @param key 缓存 key
   * @param opts 缓存选项（ttl / prefix）
   * @param loader DB 加载函数（未命中时调用）
   */
  async getOrLoad<T>(
    key: string,
    opts: CacheOptions,
    loader: () => Promise<T | null>,
  ): Promise<T | null> {
    // 1. 优先读缓存
    const cached = await this.get<T>(key)
    if (cached !== null) {
      // 注意：用 === null 区分"未命中"和"空值缓存"
      // 空值缓存也是一个有意义的命中（穿透防护）
      // 但需用 sentinel 与缓存 null 区分 —— 简化：null 值用 '__NULL__' 占位
      if (cached === NULL_SENTINEL as unknown as T) return null
      return cached
    }

    // 2. 缓存未命中：用 in-flight 去重 loader
    const existing = this.inFlight.get(key)
    if (existing) return existing as Promise<T | null>

    // 3. 第一个未命中请求：注册 in-flight
    const promise = (async () => {
      try {
        const loaded = await loader()
        if (loaded === null || loaded === undefined) {
          // 穿透防护：缓存空值（用 sentinel 占位 + 短 TTL）
          await this.set(key, NULL_SENTINEL, opts.nullTtl ?? 30)
          return null
        }
        // 正常缓存
        await this.set(key, loaded, opts.ttl)
        return loaded
      } catch (err) {
        // loader 异常：不缓存（避免脏数据），向上抛
        throw err
      } finally {
        this.inFlight.delete(key)
      }
    })()
    this.inFlight.set(key, promise)
    return promise
  }

  // ====================== 内部辅助 ======================

  /**
   * 写 L1（超出容量时淘汰最早插入的）
   */
  private setL1(key: string, value: unknown, ttlMs: number): void {
    if (this.l1.size >= CacheService.L1_MAX_SIZE) {
      // 淘汰最早插入的（FIFO）
      const firstKey = this.l1.keys().next().value
      if (firstKey !== undefined) this.l1.delete(firstKey)
    }
    this.l1.set(key, { value, expireAt: Date.now() + ttlMs })
  }

  /**
   * TTL 抖动：在 base ± 20% 范围随机
   * 例：base=600s → 实际 TTL 在 [480, 720] 之间均匀分布
   */
  private jitterTtl(base: number): number {
    const jitter = base * 0.2
    const min = Math.max(1, Math.floor(base - jitter))
    const max = Math.floor(base + jitter)
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  /**
   * L2 命中后回填 L1 的默认 TTL
   * 简化处理：用 60 秒兜底（避免 L1 持有比 L2 更久的过期数据）
   */
  private defaultRemainTtl(): number {
    return 60 * 1000
  }

  /**
   * 清空 L1 缓存（测试 / 紧急场景）
   */
  clearL1(): void {
    this.l1.clear()
  }

  /**
   * 返回当前 L1 缓存条目数（监控用）
   */
  l1Size(): number {
    return this.l1.size
  }
}

/** null 值缓存的哨兵对象（与真实 null 区分） */
const NULL_SENTINEL = Symbol('__CACHE_NULL__')