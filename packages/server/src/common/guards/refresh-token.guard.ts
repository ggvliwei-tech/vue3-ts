// 导入守卫接口、执行上下文、依赖注入装饰器和未授权异常
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
// JWT 服务，用于验证和解码 Refresh Token
import { JwtService } from '@nestjs/jwt'
// 配置服务，用于读取 Refresh Token 密钥
import { ConfigService } from '@nestjs/config'
// 用户服务，用于查询用户信息
import { UserService } from '../../modules/user/user.service'
// Redis 服务
import { RedisService } from '../../modules/redis/redis.service'

// 注入标记：用于实现 RefreshToken 复用检测的全局黑名单 TTL
const RT_REUSE_BLOCK_TTL = 900 // 15 分钟内拒绝该用户所有 refresh 请求

/**
 * Refresh Token 认证守卫
 *
 * 核心职责：
 *  1. 从 Cookie 读取 refresh_token，验证签名
 *  2. 与 Redis 中存储的 RT 比对（一致性校验）
 *  3. **RT 复用检测**：若请求中的 RT ≠ Redis 中存储的 RT
 *     → 判定为令牌盗用 → 立即吊销该用户所有 token 并抛异常
 */
@Injectable()
export class RefreshTokenGuard implements CanActivate {
  // 日志实例，用于记录安全事件
  private readonly logger = new Logger(RefreshTokenGuard.name)

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest()

    // 第一步：从 Cookie 读取 refresh_token
    const token = req.cookies?.refresh_token
    if (!token) {
      throw new UnauthorizedException('未携带刷新令牌，请重新登录')
    }

    // 第二步：验证 Token 签名
    let payload: { sub: number; username: string; sessionId?: string }
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      })
    } catch {
      throw new UnauthorizedException('刷新令牌过期或非法')
    }

    // 2a. 必须携带 sessionId（多设备会话场景必填，缺此字段视为老格式 RT，要求重新登录）
    if (!payload.sessionId) {
      throw new UnauthorizedException('刷新令牌格式错误，请重新登录')
    }

    // 第三步：从 Redis 取出当前 session 对应的 RT（精确到设备维度）
    const stored = await this.redisService.get(
      `refresh:token:${payload.sub}:${payload.sessionId}`,
    )

    // 3a. Redis 中无记录 → 该设备的 RT 已过期或被吊销
    if (!stored) {
      throw new UnauthorizedException('刷新令牌已过期，请重新登录')
    }

    // 3b. ⚠️ 关键：RT 复用检测（精确到 sessionId 维度）
    // 正常流程：refresh-token 接口每次都会轮换 RT，旧 RT 调用后立即失效
    // 如果请求中的 RT 与 Redis 中存储的不一致，说明：
    //   - 攻击者拿到了旧 RT 并尝试刷新
    //   - 或者该设备的会话已被强制下线
    // 安全策略：仅吊销该设备会话（不波及该用户其他设备），并加临时黑名单
    if (stored !== token) {
      this.logger.warn(
        `[RT 复用检测] userId=${payload.sub} sessionId=${payload.sessionId} - 检测到刷新令牌被盗用/会话失效`,
      )
      // 仅删除该 session 的 RT，不影响其他设备
      await this.redisService.del(
        `refresh:token:${payload.sub}:${payload.sessionId}`,
      )
      // 给该用户加 15 分钟黑名单，强制该设备重新登录
      await this.redisService.set(
        `blacklist:token:${payload.sub}`,
        '1',
        RT_REUSE_BLOCK_TTL,
      )
      throw new UnauthorizedException('检测到令牌盗用，请重新登录')
    }

    // 第四步：RT 一致，从数据库查询用户实体（避免直接信任 JWT payload）
    const user = await this.userService.findUserEntity(payload.sub)
    if (!user) {
      // 用户已被删除
      await this.redisService.del(`refresh:token:${payload.sub}`)
      throw new UnauthorizedException('用户不存在，请重新登录')
    }
    // 用户被禁用，立即吊销 RT
    if (user.status === 0) {
      await this.redisService.del(`refresh:token:${payload.sub}`)
      throw new UnauthorizedException('账号已被禁用，请联系管理员')
    }

    // 第五步：将用户实体挂载到请求对象，供 controller 使用
    req.user = user
    return true
  }

  /**
   * 吊销用户所有会话：清 RT + 加临时黑名单
   * 防止 RT 盗用者继续用其他端已签发的 access token
   * 注：当前阶段三已改为 session 维度，本方法保留以备未来批量吊销需求
   */
  private async revokeAllSessions(userId: number): Promise<void> {
    // 1. 删除该用户的 RT（兼容旧 key 清理）
    await this.redisService.del(`refresh:token:${userId}`)
    // 2. 临时黑名单（15 分钟），覆盖剩余的 access token 有效期
    await this.redisService.set(`blacklist:token:${userId}`, '1', RT_REUSE_BLOCK_TTL)
  }
}
