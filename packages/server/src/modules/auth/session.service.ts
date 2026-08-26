// 注入装饰器
import { Injectable } from '@nestjs/common'
// UUID v4 生成器（用于 sessionId）
import { v4 as uuidv4 } from 'uuid'
// Redis 服务，用于会话存储
import { RedisService } from '../redis/redis.service'

// 单个会话的元数据
export interface SessionInfo {
  // 会话 ID（UUID v4）
  sessionId: string
  // 登录时间（毫秒时间戳）
  loginTime: number
  // 登录 IP
  ip: string
  // User-Agent
  userAgent: string
}

/**
 * 多设备会话管理服务
 *
 * Redis 数据结构：
 *  - refresh:token:{userId}:{sessionId}  String  单设备 RT，TTL 与 JWT 一致
 *  - session:{userId}                    Hash    会话元数据，field=sessionId, value=JSON
 *
 * 与单设备版的差异：
 *  - 同一用户可在多个设备同时登录，每个设备有独立 RT
 *  - 踢下线某设备不影响其他设备
 *  - 复用检测精确到 sessionId 维度
 */
@Injectable()
export class SessionService {
  constructor(private readonly redisService: RedisService) {}

  /**
   * 生成新的 sessionId
   */
  newSessionId(): string {
    return uuidv4()
  }

  /**
   * 创建会话：写入 RT + 会话元数据
   * @param userId 用户 ID
   * @param sessionId 设备会话 ID
   * @param refreshToken 刷新令牌
   * @param meta 登录元数据（ip/userAgent）
   * @param ttl RT TTL（秒）
   */
  async create(
    userId: number,
    sessionId: string,
    refreshToken: string,
    meta: { ip: string; userAgent: string },
    ttl: number,
  ): Promise<void> {
    // 1. 存储该设备的 RT
    await this.redisService.set(
      this.rtKey(userId, sessionId),
      refreshToken,
      ttl,
    )
    // 2. 在 Hash 中记录会话元数据，TTL 与 RT 一致
    const sessionData: SessionInfo = {
      sessionId,
      loginTime: Date.now(),
      ip: meta.ip,
      userAgent: meta.userAgent,
    }
    await this.redisService.hset(
      this.sessionKey(userId),
      sessionId,
      JSON.stringify(sessionData),
    )
    // 3. 给整个 Hash 设置过期时间（避免无主会话永久残留）
    await this.redisService.expire(this.sessionKey(userId), ttl)
  }

  /**
   * 验证并获取某设备的 RT
   * @returns RT 字符串，不存在返回 null
   */
  async getRefreshToken(userId: number, sessionId: string): Promise<string | null> {
    return this.redisService.get(this.rtKey(userId, sessionId))
  }

  /**
   * 更新某设备的 RT（刷新时调用）
   */
  async updateRefreshToken(
    userId: number,
    sessionId: string,
    refreshToken: string,
    ttl: number,
  ): Promise<void> {
    await this.redisService.set(this.rtKey(userId, sessionId), refreshToken, ttl)
  }

  /**
   * 获取用户所有活跃会话列表
   * @returns 按 loginTime 倒序排列的 SessionInfo 数组
   */
  async listSessions(userId: number): Promise<SessionInfo[]> {
    const hash = await this.redisService.hgetall(this.sessionKey(userId))
    const list: SessionInfo[] = []
    for (const field of Object.keys(hash)) {
      try {
        const info = JSON.parse(hash[field]) as SessionInfo
        list.push(info)
      } catch {
        // 跳过损坏数据
      }
    }
    // 倒序：最近登录的排前面
    return list.sort((a, b) => b.loginTime - a.loginTime)
  }

  /**
   * 删除单个会话（退出该设备）
   */
  async remove(userId: number, sessionId: string): Promise<void> {
    await Promise.all([
      this.redisService.del(this.rtKey(userId, sessionId)),
      this.redisService.hdel(this.sessionKey(userId), sessionId),
    ])
  }

  /**
   * 删除用户所有会话（踢全部设备 / 用户注销）
   * 同时设置临时黑名单覆盖剩余 access token 有效期
   */
  async removeAll(userId: number, blacklistTtl = 900): Promise<void> {
    // 取出所有 sessionId 用于删除对应的 RT
    const sessions = await this.listSessions(userId)
    // 并发删除所有 RT
    const tasks: Promise<any>[] = sessions.map((s) =>
      this.redisService.del(this.rtKey(userId, s.sessionId)),
    )
    // 删除整个 Hash
    tasks.push(this.redisService.del(this.sessionKey(userId)))
    // 加临时黑名单
    tasks.push(this.redisService.set(`blacklist:token:${userId}`, '1', blacklistTtl))
    await Promise.all(tasks)
  }

  /**
   * 检查用户是否已被加入黑名单（用于 RT 复用检测后的连锁保护）
   */
  async isBlacklisted(userId: number): Promise<boolean> {
    return (await this.redisService.exists(`blacklist:token:${userId}`)) === 1
  }

  // Redis key 生成辅助方法
  private rtKey(userId: number, sessionId: string): string {
    return `refresh:token:${userId}:${sessionId}`
  }

  private sessionKey(userId: number): string {
    return `session:${userId}`
  }
}
