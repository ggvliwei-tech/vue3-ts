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
// 认证相关 Redis key（集中定义，避免手工拼接导致 key 漂移）
import { AuthKeys } from '../constants/auth-keys'
// JWT 过期时间解析工具
import { parseJwtExpiry } from '../utils/jwt.util'

/**
 * Refresh Token 认证守卫
 *
 * 核心职责：
 *  1. 从 Cookie 读取 refresh_token，验证签名
 *  2. 与 Redis 中存储的 RT 比对（一致性校验）
 *  3. **RT 复用检测**：若请求中的 RT ≠ Redis 中存储的 RT，且不在宽限窗口内
 *     → 判定为令牌盗用 → 吊销**该设备**会话（删该 sessionId 的 RT +
 *       加设备级黑名单）并抛 401。
 *
 * 注意「只吊销该设备」是刻意的，不是遗漏：用户级 key 会让一台设备出问题
 * 就把该用户其他设备一起踢下线，与「多设备会话互不影响」的承诺矛盾
 * （见实现里 blacklistSession 与 blacklistToken 的区分）。
 * 需要「踢该用户全部设备」请走 UserService.forceKick / logout-all。
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

  /**
   * 拉黑有效期（秒）＝ access token 有效期
   * 必须覆盖 access token 的剩余寿命，否则黑名单过期后被吊销的 token 又能用了
   */
  private get blacklistTtl(): number {
    return parseJwtExpiry(
      this.configService.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN'),
    )
  }

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

    // 3b. RT 不一致：先判断是不是「合法并发刷新」
    //
    // 正常流程：refresh-token 接口每次都会轮换 RT，旧 RT 用完即失效。
    // 但同一浏览器的多个标签页可能几乎同时发起刷新：先处理完的那个已经把
    // Redis 里的 RT 换成了新的，后到的请求带的却是上一轮 RT。若不加区分地
    // 判为盗用，用户会在正常使用中被莫名踢下线。
    // 因此先看宽限窗口内的「上一个 RT」是否命中，命中即视为合法并发放行，
    // 并在 req.user 上标记 rtGrace，让 AuthService 跳过本次轮换 ——
    // 否则各标签页会各自签出不同的 RT，再次互相作废，刷新风暴永不收敛。
    let fromGrace = false
    if (stored !== token) {
      const previous = await this.redisService.get(
        AuthKeys.previousRefreshToken(payload.sub, payload.sessionId),
      )
      if (previous && previous === token) {
        fromGrace = true
        this.logger.debug(
          `[RT 宽限窗口] userId=${payload.sub} sessionId=${payload.sessionId} - 命中并发刷新，放行且不轮换`,
        )
      }
    }

    // 3c. 既非当前 RT、又不在宽限窗口内 → 判定为令牌盗用
    // 安全策略：仅吊销该设备会话（不波及该用户其他设备），并加临时黑名单
    if (stored !== token && !fromGrace) {
      this.logger.warn(
        `[RT 复用检测] userId=${payload.sub} sessionId=${payload.sessionId} - 检测到刷新令牌被盗用/会话失效`,
      )
      // 只吊销「该设备」：删 RT + 加设备级黑名单
      // 注意黑名单必须用设备级 key，不能用 blacklist:token:{userId} ——
      // 用户级黑名单会被 JwtAuthGuard 应用到该用户的所有请求上，
      // 于是一台设备出问题会把该用户其他设备一起踢下线，
      // 与"多设备会话互不影响"的产品承诺直接矛盾。
      await this.redisService.del(
        AuthKeys.refreshToken(payload.sub, payload.sessionId),
      )
      await this.redisService.set(
        AuthKeys.blacklistSession(payload.sub, payload.sessionId),
        '1',
        this.blacklistTtl,
      )
      throw new UnauthorizedException('检测到令牌盗用，请重新登录')
    }

    // 第四步：RT 一致，从数据库查询用户实体（避免直接信任 JWT payload）
    const user = await this.userService.findUserEntity(payload.sub)
    if (!user) {
      // 用户已被删除 → 精确吊销该设备的 RT（key 必须带 sessionId，见下方注释）
      await this.redisService.del(
        `refresh:token:${payload.sub}:${payload.sessionId}`,
      )
      throw new UnauthorizedException('用户不存在，请重新登录')
    }
    // 用户被禁用，立即吊销该设备的 RT
    if (user.status === 0) {
      await this.redisService.del(
        `refresh:token:${payload.sub}:${payload.sessionId}`,
      )
      throw new UnauthorizedException('账号已被禁用，请联系管理员')
    }

    // 第五步：挂载当前用户上下文，供 controller 使用
    // ⚠️ sessionId 必须显式带上：它来自 JWT payload，User 实体上并没有这个字段。
    // 若只挂实体（req.user = user），controller 里的 user.sessionId 恒为 undefined，
    // 会导致 AuthService.refreshToken(userId, undefined) 把新 RT 写到
    // refresh:token:{userId}:undefined 这个野 key 上，而真正的
    // refresh:token:{userId}:{sessionId} 里仍留着旧 RT ——
    // 下次刷新时本守卫的复用检测会读到"旧 RT ≠ Cookie 里的新 RT"，
    // 误判为令牌盗用并把该用户强制下线（且写入 15 分钟黑名单）。
    // 这里刻意不展开实体，避免把 password 哈希等字段带进请求上下文。
    req.user = {
      id: user.id,
      sub: user.id, // 与 JwtAuthGuard 的 payload.sub 结构保持一致
      username: user.username,
      sessionId: payload.sessionId,
      // 命中共并发刷新的宽限窗口：controller 据此让 AuthService 跳过本次 RT 轮换
      rtGrace: fromGrace,
    }
    return true
  }

}
