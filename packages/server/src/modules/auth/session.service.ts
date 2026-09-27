// 注入装饰器
import { Injectable } from '@nestjs/common'
// 配置服务：用于把黑名单有效期对齐 access token 有效期
import { ConfigService } from '@nestjs/config'
// UUID v4 生成器（用于 sessionId）
import { v4 as uuidv4 } from 'uuid'
// Redis 服务，用于会话存储
import { RedisService } from '../redis/redis.service'
// 认证相关 Redis key（集中定义，避免多处手工拼接导致 key 漂移）
import { AuthKeys } from '../../common/constants/auth-keys'
// JWT 过期时间解析工具
import { parseJwtExpiry } from '../../common/utils/jwt.util'

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
 * Redis 数据结构（key 格式见 common/constants/auth-keys.ts）：
 *  - refresh:token:{userId}:{sessionId}        String  单设备 RT，TTL 与 JWT 一致
 *  - session:{userId}                          Hash    会话元数据，field=sessionId, value=JSON
 *  - blacklist:token:{userId}                  String  用户级黑名单，踢全部设备
 *  - blacklist:session:{userId}:{sessionId}    String  设备级黑名单，仅踢该设备
 *
 * 与单设备版的差异：
 *  - 同一用户可在多个设备同时登录，每个设备有独立 RT
 *  - 踢下线某设备不影响其他设备
 *  - 复用检测精确到 sessionId 维度
 *
 * 黑名单 TTL 必须 ≥ access token 剩余有效期，否则被踢的 access token
 * 会在黑名单过期后继续可用（见 blacklistTtl）。
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 黑名单有效期（秒）＝ access token 有效期
   *
   * 为什么不能写死 900：JWT_ACCESS_EXPIRES_IN 默认 30m（1800s），
   * 若黑名单只覆盖 900s，被踢下线的用户在剩余 900s 内仍能拿着旧
   * access token 正常调用所有接口 —— 强制下线形同虚设。
   * 这里直接从配置推导，保证两者永远对齐。
   */
  private get blacklistTtl(): number {
    return parseJwtExpiry(
      this.configService.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN'),
    )
  }

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
      AuthKeys.refreshToken(userId, sessionId),
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
      AuthKeys.session(userId),
      sessionId,
      JSON.stringify(sessionData),
    )
    // 3. 给整个 Hash 设置过期时间（避免无主会话永久残留）
    await this.redisService.expire(AuthKeys.session(userId), ttl)
  }

  /**
   * 验证并获取某设备的 RT
   * @returns RT 字符串，不存在返回 null
   */
  async getRefreshToken(userId: number, sessionId: string): Promise<string | null> {
    return this.redisService.get(AuthKeys.refreshToken(userId, sessionId))
  }

  /**
   * 更新某设备的 RT（刷新时调用）
   *
   * @param graceSeconds > 0 时，把「被替换掉的旧 RT」暂存为上一个 RT，
   *        供并发刷新在宽限窗口内使用（详见 AuthKeys.previousRefreshToken）
   */
  async updateRefreshToken(
    userId: number,
    sessionId: string,
    refreshToken: string,
    ttl: number,
    graceSeconds = 0,
  ): Promise<void> {
    const key = AuthKeys.refreshToken(userId, sessionId)
    if (graceSeconds > 0) {
      const current = await this.redisService.get(key)
      if (current) {
        await this.redisService.set(
          AuthKeys.previousRefreshToken(userId, sessionId),
          current,
          graceSeconds,
        )
      }
    }
    await this.redisService.set(key, refreshToken, ttl)
  }

  /**
   * 读取「上一个 RT」（仅在宽限窗口内存在，过期返回 null）
   */
  async getPreviousRefreshToken(
    userId: number,
    sessionId: string,
  ): Promise<string | null> {
    return this.redisService.get(
      AuthKeys.previousRefreshToken(userId, sessionId),
    )
  }

  /**
   * 获取用户所有活跃会话列表
   * @returns 按 loginTime 倒序排列的 SessionInfo 数组
   */
  async listSessions(userId: number): Promise<SessionInfo[]> {
    const hash = await this.redisService.hgetall(AuthKeys.session(userId))
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
   * 删除单个会话（登出 / 踢指定设备）
   * 同时写入设备级黑名单，让该设备手里的 access token 立即失效 ——
   * 只删 RT 是不够的：access token 是自包含的，不查库就能通过校验，
   * 不拉黑的话被踢用户在剩余有效期内照常调用所有接口。
   */
  async remove(userId: number, sessionId: string): Promise<void> {
    await Promise.all([
      this.redisService.del(AuthKeys.refreshToken(userId, sessionId)),
      this.redisService.hdel(AuthKeys.session(userId), sessionId),
      this.blacklistSession(userId, sessionId),
    ])
  }

  /**
   * 删除用户所有会话（踢全部设备 / 用户注销）
   * 同时设置用户级黑名单覆盖剩余 access token 有效期
   * @param ttl 黑名单有效期（秒），默认对齐 access token 有效期
   */
  async removeAll(
    userId: number,
    ttl: number = this.blacklistTtl,
  ): Promise<void> {
    // 取出所有 sessionId 用于删除对应的 RT
    const sessions = await this.listSessions(userId)
    // 并发删除所有 RT
    const tasks: Promise<unknown>[] = sessions.map((s) =>
      this.redisService.del(AuthKeys.refreshToken(userId, s.sessionId)),
    )
    // 删除整个 Hash
    tasks.push(this.redisService.del(AuthKeys.session(userId)))
    // 加用户级黑名单（覆盖该用户全部设备）
    tasks.push(this.redisService.set(AuthKeys.blacklistUser(userId), '1', ttl))
    await Promise.all(tasks)
  }

  /**
   * 拉黑单个设备：该设备的 access token 立即失效，其他设备不受影响
   * 用于 RT 复用检测（疑似令牌盗用，只吊销这一台）和踢指定设备
   */
  async blacklistSession(userId: number, sessionId: string): Promise<void> {
    await this.redisService.set(
      AuthKeys.blacklistSession(userId, sessionId),
      '1',
      this.blacklistTtl,
    )
  }

  /** 该设备是否已被下线 */
  async isSessionBlacklisted(
    userId: number,
    sessionId: string,
  ): Promise<boolean> {
    return (
      (await this.redisService.exists(
        AuthKeys.blacklistSession(userId, sessionId),
      )) === 1
    )
  }

  /** 该用户是否已被「全设备」拉黑 */
  async isBlacklisted(userId: number): Promise<boolean> {
    return (await this.redisService.exists(AuthKeys.blacklistUser(userId))) === 1
  }
}
