// 导入守卫接口，决定是否放行请求
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
// JWT 服务，用于验证和解码 Token
import { JwtService } from '@nestjs/jwt';
// 配置服务，用于读取 JWT 密钥
import { ConfigService } from '@nestjs/config';

// 标记为可注入的服务
@Injectable()
// 实现 CanActivate 接口，作为轻量版 JWT 认证守卫
export class JwtAuthSimpleGuard implements CanActivate {
  // 构造函数注入依赖
  constructor(
    private readonly jwtService: JwtService, // 注入 JWT 服务，用于 Token 验证
    private readonly configService: ConfigService, // 注入配置服务，获取 JWT 密钥
  ) {}

  // 守卫核心方法，返回 true 放行请求，返回 false 或抛异常则拒绝
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 从执行上下文切换到 HTTP 上下文，获取请求对象
    const request = context.switchToHttp().getRequest();

    // 第一步：从请求头中获取 Authorization 字段
    const authHeader = request.headers.authorization;
    // 如果请求头中没有 Authorization，说明未携带 Token
    if (!authHeader) {
      throw new UnauthorizedException('未携带Token，请先登录');
    }

    // 第二步：拆分 Bearer Token 格式（格式为 "Bearer xxx"）
    const [type, token] = authHeader.split(' ');
    // 验证类型是否为 Bearer 且 token 不为空
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Token格式错误，格式：Bearer xxx');
    }

    try {
      // 第三步：使用 JWT 密钥验证并解码 Token（不查数据库）
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });

      // 第四步：将 Token 载荷挂载到请求对象，后续可通过 request.user 获取
      request.user = payload;
      // 所有验证通过，放行请求
      return true;
    } catch {
      // 如果 Token 验证失败（过期、伪造等），捕获异常并拒绝请求
      throw new UnauthorizedException('Token已过期或无效，请重新登录');
    }
  }
}
