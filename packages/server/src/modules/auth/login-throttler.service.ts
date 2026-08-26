// 注入装饰器
import { Injectable } from '@nestjs/common'
// Redis 服务，用于计数与锁定
import { RedisService } from '../redis/redis.service'

// 配置常量
const FAIL_COUNT_LIMIT = 5        // 失败多少次后触发锁定
const LOCK_TTL = 15 * 60           // 锁定时长（秒）：15 分钟
const IP_LIMIT_WINDOW = 10         // IP 限流时间窗口（秒）
const IP_LIMIT_MAX = 5             // 时间窗口内最大次数

/**
 * 登录风控服务
 *
 * 功能：
 *  1. 记录登录失败次数（按 username 维度）
 *  2. 超过阈值自动锁定账号（15 分钟）
 *  3. 登录成功的 IP 维度限流（10 秒内最多 5 次，防爆破）
 *
 * Redis key 命名：
 *  - login:fail:{username}  失败计数器（INCR + EXPIRE 第一次设置 TTL）
 *  - login:locked:{username}  锁定标记（SETNX + EX 15min）
 *  - login:ip:{ip}  IP 维度的滑动窗口（INCR + EXPIRE 第一次设置 TTL）
 */
@Injectable()
export class LoginThrottlerService {
  constructor(private readonly redisService: RedisService) {}

  /**
   * IP 维度限流检查
   * @param ip 客户端 IP
   * @returns true 表示未超限，false 表示需拒绝
   */
  async checkIp(ip: string): Promise<boolean> {
    const key = `login:ip:${ip}`
    const count = await this.redisService.incr(key)
    // 第一次写入时设置 TTL（窗口起点）
    if (count === 1) {
      await this.redisService.expire(key, IP_LIMIT_WINDOW)
    }
    return count <= IP_LIMIT_MAX
  }

  /**
   * 检查账号是否已被锁定
   * @param username 用户名
   * @returns 剩余锁定秒数，0 表示未锁定
   */
  async getLockRemaining(username: string): Promise<number> {
    const ttl = await this.redisService.ttl(`login:locked:${username}`)
    return ttl > 0 ? ttl : 0
  }

  /**
   * 记录一次登录失败
   * 累计到阈值时自动触发账号锁定
   * @param username 用户名
   * @returns 当前失败次数（达到阈值时返回 -1 表示已锁定）
   */
  async recordFailure(username: string): Promise<number> {
    const failKey = `login:fail:${username}`
    const lockKey = `login:locked:${username}`
    // 自增失败计数
    const count = await this.redisService.incr(failKey)
    // 第一次失败时设置 TTL（15 分钟计数窗口）
    if (count === 1) {
      await this.redisService.expire(failKey, LOCK_TTL)
    }
    // 达到阈值则锁定账号
    if (count >= FAIL_COUNT_LIMIT) {
      // setnx 保证只设置一次，避免反复刷新 TTL 延长锁定时间
      await this.redisService.setnx(lockKey, '1', LOCK_TTL)
      return -1
    }
    return count
  }

  /**
   * 登录成功后清除失败计数和锁定
   * @param username 用户名
   */
  async clearFailures(username: string): Promise<void> {
    await Promise.all([
      this.redisService.del(`login:fail:${username}`),
      this.redisService.del(`login:locked:${username}`),
    ])
  }
}
