import {
  CanActivate, // 守卫接口，决定是否放行请求
  ExecutionContext, // 执行上下文，包含请求信息
  Injectable, // 依赖注入装饰器
  UnauthorizedException, // 未授权异常，用于认证失败
} from '@nestjs/common';
// JWT 服务，用于验证和解密 Token
import { JwtService } from '@nestjs/jwt';
// 配置服务，用于读取 JWT 密钥
import { ConfigService } from '@nestjs/config';
// 用户服务，用于查询用户信息
import { UserService } from '../../modules/user/user.service';

// 标记为可注入的服务
@Injectable()
// 实现 CanActivate 接口，作为 JWT 认证守卫
export class JwtAuthGuard implements CanActivate {
  // 构造函数注入依赖
  constructor(
    private readonly jwtService: JwtService, // 注入 JWT 服务，用于 Token 验证
    private readonly configService: ConfigService, // 注入配置服务，获取 JWT 密钥
    private readonly userService: UserService, // 注入用户服务，用于查询用户
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
      // 第三步：使用 JWT 密钥验证并解码 Token
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });

      // 第四步：从 Token 载荷中获取用户 ID（payload.sub），查询数据库验证用户是否存在
      const user = await this.userService.findById(payload.sub);
      // 如果用户不存在，拒绝请求
      if (!user) {
        throw new UnauthorizedException('用户不存在，请重新登录');
      }
      // 如果用户状态为 0（已禁用），拒绝请求
      if (user.status === 0) {
        throw new UnauthorizedException('账号已禁用');
      }

      // 第五步：将用户对象挂载到请求对象上
      // 控制器中可以通过 @CurrentUser() 装饰器获取此数据
      request.user = user;
      // 所有验证通过，放行请求
      return true;
    } catch (err) {
      // 如果 Token 验证失败（过期、伪造等），捕获异常并拒绝请求
      throw new UnauthorizedException('Token已过期或无效，请重新登录');
    }
  }
}
