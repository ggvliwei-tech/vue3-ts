// 导入 NestJS 核心依赖
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
// JWT 服务，用于验证 Token
import { JwtService } from '@nestjs/jwt'
// 配置服务，用于读取 JWT 密钥
import { ConfigService } from '@nestjs/config'
// Redis 服务，用于黑名单检查
import { RedisService } from '../../modules/redis/redis.service'
// RBAC 服务，用于加载用户角色和权限
import { RbacService } from '../../modules/rbac/rbac.service'

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
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly rbacService: RbacService,
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
      const isBlacklisted = await this.redisService.exists(`blacklist:token:${payload.sub}`)
      if (isBlacklisted) {
        throw new UnauthorizedException('账号已在其他地方被强制下线，请重新登录')
      }

      // 第五步：加载用户的角色和权限码（带缓存）并挂到 request.user
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
      // 区分"Token验证失败"和"业务抛出的UnauthorizedException"
      // 后者已经有明确 msg，避免被覆盖
      if (err instanceof UnauthorizedException) throw err
      throw new UnauthorizedException('Token已过期或无效，请重新登录')
    }
  }
}
