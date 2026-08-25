// Controller 控制器装饰器，将类标记为 NestJS 控制器
import {
  Controller,
  // Get 装饰器，用于处理 HTTP GET 请求
  Get,
  // Post 装饰器，用于处理 HTTP POST 请求
  Post,
  // Body 装饰器，用于提取请求体（request body）数据
  Body,
  // UseGuards 守卫装饰器，用于请求拦截和验证；Res 响应对象装饰器；Param 路由参数装饰器
  UseGuards, Res, Param,
} from '@nestjs/common';
// Express Response 类型，提供 cookie、clearCookie 等响应方法
import type { Response } from 'express';
// ApiTags Swagger 接口分组标签装饰器
import {
  ApiTags,
  // ApiOperation Swagger 接口操作描述装饰器
  ApiOperation,
  // ApiBearerAuth Swagger Bearer Token 认证标识装饰器
  ApiBearerAuth,
} from '@nestjs/swagger';
// 用户服务，注入以调用业务逻辑方法
import { UserService } from './user.service';
// 注册用户 DTO，定义注册请求的数据结构和校验规则
import { CreateUserDto } from './dto/create-user.dto';
// 登录用户 DTO，定义登录请求的数据结构和校验规则
import { LoginUserDto } from './dto/login-user.dto';
// JWT 认证守卫，用于保护需要登录验证的接口
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
// 当前用户装饰器，用于从 JWT Token 中解析并获取用户信息
import { CurrentUser } from '../../common/decorators/current-user.decorator';
// 刷新令牌守卫，用于验证 RefreshToken 有效性
import { RefreshTokenGuard } from '../../common/guards/refresh-token.guard';
// 忘记密码 DTO
import { ForgotPasswordDto } from './dto/forgot-password.dto';

// Swagger 标签装饰器，将此控制器下的接口归类到 "用户管理模块" 分组
@ApiTags('用户管理模块')
// 控制器装饰器，设置路由前缀为 /user
@Controller('user')
export class UserController {
  // 构造函数注入用户服务实例，private readonly 使其成为类属性
  constructor(private readonly userService: UserService) {}

  // Swagger 接口描述：注册用户
  @ApiOperation({ summary: '注册用户' })
  // Post 路由装饰器，注册接口路径为 POST /user/register
  @Post('register')
  // 注册方法：接收 CreateUserDto 作为请求体参数，调用 service 创建用户
  register(@Body() createUserDto: CreateUserDto) {
    // 调用用户服务的 create 方法创建用户并返回结果
    return this.userService.create(createUserDto);
  }

  // Swagger 接口描述：通过手机号 + 验证码重置密码
  @ApiOperation({ summary: '通过手机号验证码重置密码' })
  // Post 路由装饰器，忘记密码接口路径为 POST /user/forgot-password
  @Post('forgot-password')
  // 忘记密码方法：接收 ForgotPasswordDto 作为请求体参数
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    // 调用用户服务重置密码
    return this.userService.resetPasswordByPhone(dto);
  }

  // Swagger 接口描述：用户登录，RefreshToken 存入 HttpOnly Cookie
  @ApiOperation({ summary: '登录，Refresh存入HttpOnly Cookie' })
  // Post 路由装饰器，登录接口路径为 POST /user/login
  @Post('login')
  // 登录方法：async 异步方法，接收 DTO 和响应对象
  async login(
    // Body 装饰器提取请求体数据，类型为 LoginUserDto
    @Body() dto: LoginUserDto,
    // Res 装饰器获取 Express 响应对象，passthrough: true 表示不拦截返回
    @Res({ passthrough: true }) res: Response,
  ) {
    // 调用用户服务的 login 方法，解构获取 accessToken、refreshToken 和 userInfo
    const { accessToken, refreshToken, userInfo } = await this.userService.login(dto);

    // ========== 写入 HttpOnly Cookie ==========
    // 判断是否为生产环境，用于决定 Cookie 的 secure 属性
    const isProd = process.env.NODE_ENV === 'production';
    // 使用 res.cookie 设置 refreshToken 到 HttpOnly Cookie 中，新 Cookie 覆盖旧 Cookie 使其失效
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true, // JS 无法读取 Cookie，核心安全配置，防止 XSS 攻击
      secure: isProd, // 生产环境开启 Secure 标志，仅通过 HTTPS 传输 Cookie
      sameSite: 'lax', // 防止 CSRF 跨站请求伪造攻击
      maxAge: 7 * 24 * 60 * 60 * 1000, // Cookie 有效期 7 天（毫秒），与 refreshToken 有效期一致
      path: '/api/v1/user', // Cookie 生效路径，仅刷新和登出接口可携带此 Cookie
    });

    // JSON 响应只返回 accessToken 给前端用于后续请求认证
    return { accessToken, userInfo };
  }

  // Swagger 接口描述：刷新 AccessToken，自动读取 Cookie 中的 RefreshToken
  @ApiOperation({ summary: '刷新AccessToken，自动读取Cookie里的Refresh' })
  // Post 路由装饰器，刷新令牌接口路径为 POST /user/refresh-token
  @Post('refresh-token')
  // 使用 RefreshTokenGuard 守卫验证 RefreshToken 有效性
  @UseGuards(RefreshTokenGuard)
  // 刷新方法：async 异步方法，接收当前用户信息和响应对象
  async refresh(
    // CurrentUser 装饰器从 JWT 中解析获取当前用户信息
    @CurrentUser() user: any,
    // Res 装饰器获取 Express 响应对象，passthrough: true 不拦截返回
    @Res({ passthrough: true }) res: Response,
  ) {
    // 调用用户服务的 refreshToken 方法，获取新的 accessToken 和 refreshToken
    const { accessToken, refreshToken: newRefreshToken } = await this.userService.refreshToken(user.id);

    // 用新的 refreshToken 覆盖旧 Cookie，实现 Token 轮换（更安全）
    // 判断是否为生产环境
    const isProd = process.env.NODE_ENV === 'production';
    // 设置新的 refreshToken 到 HttpOnly Cookie
    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true, // JS 无法读取，防止 XSS 攻击
      secure: isProd, // 生产环境仅通过 HTTPS 传输
      sameSite: 'lax', // 防止 CSRF 攻击
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天有效期（毫秒）
      path: '/api/v1/user', // Cookie 生效路径
    });

    // 返回新的 accessToken 给前端
    return { accessToken };
  }

  // Swagger 接口描述：退出登录，清空 Cookie 和数据库中的 RefreshToken
  @ApiOperation({ summary: '退出登录：清空Cookie+数据库RefreshToken' })
  // Post 路由装饰器，登出接口路径为 POST /user/logout
  @Post('logout')
  // 使用 JwtAuthGuard 守卫，确保请求携带有效的 JWT Token
  @UseGuards(JwtAuthGuard)
  // 登出方法：async 异步方法，接收当前用户信息和响应对象
  async logout(
    // CurrentUser 装饰器获取当前登录用户信息
    @CurrentUser() user: any,
    // Res 装饰器获取 Express 响应对象
    @Res({ passthrough: true }) res: Response,
  ) {
    // 调用用户服务的 logout 方法，从 Redis 删除用户的 RefreshToken
    await this.userService.logout(user.id);
    // 使用 res.clearCookie 清除浏览器中的 refresh_token Cookie
    res.clearCookie('refresh_token', {
      httpOnly: true, // 与设置时保持一致的 httpOnly 标志
      sameSite: 'lax', // 与设置时保持一致的 sameSite 标志
      path: '/api/v1/user', // 指定要清除的 Cookie 路径
    });
    // 返回退出成功消息
    return { msg: '退出成功' };
  }

  // ===== 以下为需要 JWT 鉴权的接口 =====

  // Swagger 接口描述：强制用户下线（管理员功能）
  @ApiOperation({ summary: '强制用户下线（管理员功能）' })
  // Post 路由装饰器，强制下线接口路径为 POST /user/:id/kick，:id 为用户 ID 参数
  @UseGuards(JwtAuthGuard)
  @Post(':id/kick')
  // 强制下线方法：接收路由参数 userId 和当前用户信息
  async forceKick(@Param('id') userId: string, @CurrentUser() user: any) {
    // 调用用户服务的 forceKick 方法，将字符串 userId 转为数字后传入，并传入操作用户信息用于权限校验
    return this.userService.forceKick(Number(userId), user);
  }

  // Swagger 接口描述：切换用户状态（启用/禁用，管理员功能）
  @ApiOperation({ summary: '切换用户状态（启用/禁用）' })
  // Post 路由装饰器，切换状态接口路径为 POST /user/:id/toggle-status
  @UseGuards(JwtAuthGuard)
  @Post(':id/toggle-status')
  // 切换状态方法：接收路由参数 userId 和当前用户信息
  async toggleStatus(@Param('id') userId: string, @CurrentUser() user: any) {
    // 调用用户服务的 toggleStatus 方法，将字符串 userId 转为数字后传入，并传入操作用户信息用于权限校验
    return this.userService.toggleStatus(Number(userId), user);
  }

  // Swagger 接口描述：获取当前登录用户信息
  @ApiOperation({ summary: '获取当前用户信息' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@CurrentUser() user: any) {
    // 返回当前登录用户的基本信息
    return this.userService.findById(user.id);
  }

  // Swagger 接口描述：获取用户列表（需要 Token 验证）
  @ApiOperation({ summary: '获取用户列表（需要Token）' })
  // Swagger Bearer Token 认证标识，在文档中显示 Token 输入框
  @ApiBearerAuth()
  // 挂载 JwtAuthGuard 守卫，请求必须携带有效的 JWT Token
  @UseGuards(JwtAuthGuard)
  // Get 路由装饰器，获取用户列表接口路径为 GET /user
  @Get()
  // 查询所有用户方法：通过 @CurrentUser() 获取当前登录用户信息
  findAll(@CurrentUser() user: any) {
    // 调用用户服务的 findAll 方法返回所有用户列表
    return this.userService.findAll();
  }
}
