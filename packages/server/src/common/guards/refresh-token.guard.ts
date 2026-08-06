// 导入守卫接口、执行上下文、依赖注入装饰器和未授权异常
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
// JWT 服务，用于验证和解码 Refresh Token
import { JwtService } from '@nestjs/jwt';
// 配置服务，用于读取 Refresh Token 密钥
import { ConfigService } from '@nestjs/config';
// 用户服务，用于查询用户信息
import { UserService } from '../../modules/user/user.service';

// 标记为可注入的服务
@Injectable()
// 实现 CanActivate 接口，作为 Refresh Token 认证守卫
export class RefreshTokenGuard implements CanActivate {
  // 构造函数注入依赖
  constructor(
    private readonly jwtService: JwtService, // 注入 JWT 服务，用于 Token 验证
    private readonly configService: ConfigService, // 注入配置服务，获取 Refresh Token 密钥
    private readonly userService: UserService, // 注入用户服务，用于查询用户
  ) {}

  // 守卫核心方法，返回 true 放行请求，返回 false 或抛异常则拒绝
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 从执行上下文切换到 HTTP 上下文，获取请求对象
    const req = context.switchToHttp().getRequest();

    // 从 Cookie 中读取 refresh_token，不再从 Authorization Header 获取
    const token = req.cookies?.refresh_token;
    // 如果 Cookie 中没有 refresh_token，说明未携带刷新令牌
    if (!token) {
      throw new UnauthorizedException('未携带刷新令牌，请重新登录');
    }

    try {
      // 使用 Refresh 专用密钥校验 Token
      const payload = this.jwtService.verify(token, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });

      // 数据库比对是否一致（防止已退出登录的旧 Token）
      // 从 Token 载荷中获取用户 ID，查询数据库验证用户
      const user = await this.userService.findById(payload.sub);
      // 如果用户不存在，或数据库中的 refreshToken 与当前 Token 不一致，拒绝请求
      if (!user || user.refreshToken !== token) {
        throw new UnauthorizedException('刷新令牌已失效，请重新登录');
      }

      // 将用户对象挂载到请求对象上
      req.user = user;
      // 所有验证通过，放行请求
      return true;
    } catch {
      // 如果 Token 验证失败（过期、伪造等），捕获异常并拒绝请求
      throw new UnauthorizedException('刷新令牌过期或非法');
    }
  }
}
