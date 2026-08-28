// 导入 NestJS 核心依赖
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
// JWT 服务，用于验证 Token
import { JwtService, JsonWebTokenError, TokenExpiredError } from '@nestjs/jwt'
// 配置服务，用于读取 JWT 密钥
import { ConfigService } from '@nestjs/config'
// Redis 服务，用于黑名单检查
import { RedisService } from '../../modules/redis/redis.service'
// RBAC 服务，用于加载用户角色和权限
import { RbacService } from '../../modules/rbac/rbac.service'
// nest-winston 日志
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston'
import { Logger as WinstonLogger } from 'winston'

/**
 * JWT 认证守卫
 *
 * 职责：
 *  1. 校验请求头中的 Bearer Token 格式与签名
 *  2. 检查 Redis 黑名单（强制下线拦截）
 *  3. 从 RbacService 查询用户角色/权限码，挂载到 request.user
 *
 * 注：此守卫不直接查 sys_user 表，需要完整用户信息时控制器自行注入 UserService
 *
 * 为减少 DB 压力，角色和权限查询由 RbacService 内部 Redis 缓存（10 分钟 TTL）
 *
 * C2 修复：catch 块细分异常类型
 *  - TokenExpiredError / JsonWebTokenError → 401 Token 无效
 *  - Redis/RBAC 基础设施错误 → 503 服务暂不可用（不再误导运维）
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly rbacService: RbacService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: WinstonLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()

    // 第一步：获取 Authorization 头
    const authHeader = request.headers.authorization
    if (!authHeader) {
      throw new UnauthorizedException('未携带Token，请先登录')
    }

    // 第二步：解析 Bearer xxx
    const [type, token] = authHeader.split(' ')
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Token格式错误，格式：Bearer xxx')
    }

    try {
      // 第三步：验证 Token 签名
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      })

      // 第四步：检查 Redis 黑名单（强制下线拦截）
      // 黑名单检查失败不应阻断请求（避免 Redis 抖动导致 401）
      try {
        const isBlacklisted = await this.redisService.exists(
          `blacklist:token:${payload.sub}`,
        )
        if (isBlacklisted) {
          throw new UnauthorizedException('账号已在其他地方被强制下线，请重新登录')
        }
      } catch (err) {
        if (err instanceof UnauthorizedException) throw err
        // 黑名单检查失败仅记日志，不阻断（fail-open）
        this.logger.warn(
          `[Auth] 黑名单检查失败: ${(err as Error).message}`,
        )
      }

      // 第五步：加载用户的角色和权限码（带缓存，Redis 故障时降级到 DB）
      const [roles, permissions] = await Promise.all([
        this.rbacService.getUserRoles(payload.sub),
        this.rbacService.getUserPermissions(payload.sub),
      ])

      // 合并 JWT payload 和 RBAC 信息
      request.user = {
        ...payload,        // 原始 JWT payload：{ sub, username, iat, exp }
        id: payload.sub,
        roles,             // 角色编码数组：['admin', 'editor']
        permissions,       // 权限码数组：['user:list', 'book:create']
      }

      return true
    } catch (err) {
      // 1. 业务抛出的 UnauthorizedException 直接透传
      if (err instanceof UnauthorizedException) throw err

      // 2. JWT 签名/过期错误 → 401
      if (err instanceof TokenExpiredError) {
        throw new UnauthorizedException('Token已过期，请重新登录')
      }
      if (err instanceof JsonWebTokenError) {
        throw new UnauthorizedException('Token无效，请重新登录')
      }

      // 3. 其他（Redis / RBAC 抛出的基础设施错误）→ 503 而非 401
      //    避免误导运维以为 JWT 配置有问题
      this.logger.error(
        `[Auth] 基础设施错误: ${(err as Error).message}`,
      )
      throw new ServiceUnavailableException(
        '认证服务暂时不可用，请稍后重试',
      )
    }
  }
}
