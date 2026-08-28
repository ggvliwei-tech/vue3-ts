// Controller 控制器装饰器，将类标记为 NestJS 控制器
import {
  Controller,
  // Get 装饰器，用于处理 HTTP GET 请求
  Get,
  // Post 装饰器，用于处理 HTTP POST 请求
  Post,
  // Body 装饰器，用于提取请求体（request body）数据
  Body,
  // Req 装饰器，用于获取原生 Request 对象（取客户端 IP）
  Req,
  // ForbiddenException 用于 Origin 校验失败的 403 响应
  ForbiddenException,
  // UseGuards 守卫装饰器，用于请求拦截和验证；Res 响应对象装饰器；Param 路由参数装饰器
  UseGuards, Res, Param, Query,
} from '@nestjs/common';
// Express Request/Response 类型
import type { Request, Response } from 'express';
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
// 权限守卫，基于 @Permissions 装饰器做细粒度校验
import { PermissionsGuard } from '../../common/guards/permissions.guard';
// 当前用户装饰器，用于从 JWT Token 中解析并获取用户信息
import { CurrentUser } from '../../common/decorators/current-user.decorator';
// 权限装饰器，声明接口所需的权限码
import { Permissions } from '../../common/decorators/permissions.decorator';
// 刷新令牌守卫，用于验证 RefreshToken 有效性
import { RefreshTokenGuard } from '../../common/guards/refresh-token.guard';
// 忘记密码 DTO
import { ForgotPasswordDto } from './dto/forgot-password.dto';
// M5 + M7：用户列表分页参数 DTO
import { QueryUserListDto } from './dto/query-user-list.dto';
// C7 修复：注入 ConfigService 读取 CORS 白名单用于 Origin 校验
import { ConfigService } from '@nestjs/config';

// Swagger 标签装饰器，将此控制器下的接口归类到 "用户管理模块" 分组
@ApiTags('用户管理模块')
// 控制器装饰器，设置路由前缀为 /user
@Controller('user')
export class UserController {
  // 允许的 Origin 列表（从 CORS_ORIGINS 环境变量读，逗号分隔）
  private readonly allowedOrigins: string[]
  // 构造函数注入用户服务实例，private readonly 使其成为类属性
  constructor(
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {
    this.allowedOrigins = this.configService.get<string[]>('CORS_ORIGINS') || []
  }

  /**
   * C7 修复：CSRF 防御 - 检查 Origin 头是否在白名单内
   * 仅对写操作生效（login/refresh/logout），避免跨站表单提交
   * sameSite=strict 已能挡住大部分 CSRF，这是防御纵深的第二层
   */
  private assertSafeOrigin(req: Request): void {
    const origin = req.headers['origin'] || req.headers['referer']
    if (!origin) {
      // 浏览器发起的请求必带 Origin；缺失可能是直接 API 调用，允许通过
      // 如需更严，可改为 throw
      return
    }
    const originUrl = Array.isArray(origin) ? origin[0] : origin
    if (!this.allowedOrigins.includes(originUrl)) {
      throw new ForbiddenException(`非法 Origin：${originUrl}`)
    }
  }

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
    // Req 装饰器获取 Express 请求对象，用于提取客户端真实 IP 和 User-Agent
    @Req() req: Request,
    // Res 装饰器获取 Express 响应对象，passthrough: true 表示不拦截返回
    @Res({ passthrough: true }) res: Response,
  ) {
    // C7: Origin 白名单校验（防 CSRF）
    this.assertSafeOrigin(req)
    // 提取客户端 IP：优先取代理转发的 X-Forwarded-For，否则取 socket.remoteAddress
    // 兼容 Nginx/Cloudflare 等反代场景
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown'
    // 提取 User-Agent 头，用于多设备会话展示
    const userAgent = (req.headers['user-agent'] as string) || 'unknown'
    // 调用用户服务的 login 方法，传入 ip + userAgent 用于 IP 限流与多设备会话
    const { accessToken, refreshToken, userInfo } = await this.userService.login(dto, { ip, userAgent });

    // ========== 写入 HttpOnly Cookie ==========
    // 判断是否为生产环境，用于决定 Cookie 的 secure 属性
    const isProd = process.env.NODE_ENV === 'production';
    // 使用 res.cookie 设置 refreshToken 到 HttpOnly Cookie 中，新 Cookie 覆盖旧 Cookie 使其失效
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true, // JS 无法读取 Cookie，核心安全配置，防止 XSS 攻击
      secure: isProd, // 生产环境开启 Secure 标志，仅通过 HTTPS 传输 Cookie
      // C7 修复：sameSite 改 'strict' 阻止任何跨站请求携带 Cookie
      // 注意：strict 在跨域跳转场景（如 SSO）会失效，本项目没有此场景故可放心使用
      sameSite: 'strict',
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
    // Req 用于 Origin 校验
    @Req() req: Request,
    // Res 装饰器获取 Express 响应对象，passthrough: true 不拦截返回
    @Res({ passthrough: true }) res: Response,
  ) {
    // C7: Origin 白名单校验（防 CSRF）
    this.assertSafeOrigin(req)
    // 调用用户服务的 refreshToken 方法，传入 sessionId 定位到具体设备
    // sessionId 由 RefreshTokenGuard 从 JWT payload 中提取并挂到 req.user
    const { accessToken, refreshToken: newRefreshToken } = await this.userService.refreshToken(user.id, user.sessionId);

    // 用新的 refreshToken 覆盖旧 Cookie，实现 Token 轮换（更安全）
    // 判断是否为生产环境
    const isProd = process.env.NODE_ENV === 'production';
    // 设置新的 refreshToken 到 HttpOnly Cookie
    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true, // JS 无法读取，防止 XSS 攻击
      secure: isProd, // 生产环境仅通过 HTTPS 传输
      sameSite: 'strict', // C7 修复：严格 sameSite 防 CSRF
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
    // 调用用户服务的 logout 方法，删除当前 session 的 RT 和会话元数据
    await this.userService.logout(user.id, user.sessionId);
    // 使用 res.clearCookie 清除浏览器中的 refresh_token Cookie
    // C7 修复：与 set 时保持一致（含 secure）
    const isProd = process.env.NODE_ENV === 'production'
    res.clearCookie('refresh_token', {
      httpOnly: true, // 与设置时保持一致的 httpOnly 标志
      secure: isProd, // 必须与 set 时一致，否则生产环境浏览器无法清除
      sameSite: 'strict', // 与设置时保持一致
      path: '/api/v1/user', // 指定要清除的 Cookie 路径
    });
    // 返回退出成功消息
    return { msg: '退出成功' };
  }

  // ===== 以下为需要 JWT 鉴权的接口 =====

  // Swagger 接口描述：强制用户下线（管理员功能）
  @ApiOperation({ summary: '强制用户下线（管理员功能）' })
  // Post 路由装饰器，强制下线接口路径为 POST /user/:id/kick，:id 为用户 ID 参数
  // 双重守卫：先 JWT 认证注入 roles/permissions，再 PermissionsGuard 校验 user:kick 权限码
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('user:kick')
  @Post(':id/kick')
  // 强制下线方法：接收路由参数 userId、query 中的 sessionId（可选）以及当前用户信息
  async forceKick(
    @Param('id') userId: string,
    // sessionId 可选，不传则踢全部设备
    @Body() body: { sessionId?: string } | undefined,
    @CurrentUser() user: any,
  ) {
    // 调用用户服务的 forceKick 方法；传入 body.sessionId 可指定踢某设备
    return this.userService.forceKick(Number(userId), body?.sessionId);
  }

  // Swagger 接口描述：切换用户状态（启用/禁用，管理员功能）
  @ApiOperation({ summary: '切换用户状态（启用/禁用）' })
  // Post 路由装饰器，切换状态接口路径为 POST /user/:id/toggle-status
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('user:toggle-status')
  @Post(':id/toggle-status')
  // 切换状态方法：接收路由参数 userId
  async toggleStatus(@Param('id') userId: string) {
    // 调用用户服务的 toggleStatus 方法（不再需要 user 形参，权限校验已上移）
    return this.userService.toggleStatus(Number(userId));
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

  // Swagger 接口描述：获取用户列表（需要 Token 验证 + user:list 权限码）
  @ApiOperation({ summary: '获取用户列表（需要Token）' })
  // Swagger Bearer Token 认证标识，在文档中显示 Token 输入框
  @ApiBearerAuth()
  // 挂载双重守卫：JWT 认证 + 权限校验
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('user:list')
  // Get 路由装饰器，获取用户列表接口路径为 GET /user
  @Get()
  // M5 + M7：使用 DTO 接分页参数；响应去掉 phone 字段
  // 增量：DTO 新增 keyword/status 筛选，透传到 service
  findAll(@Query() dto: QueryUserListDto) {
    // 调用用户服务的 findAll 方法返回分页用户列表
    return this.userService.findAll(dto.page ?? 1, dto.pageSize ?? 20, {
      keyword: dto.keyword,
      status: dto.status,
    });
  }

  // ===== 多设备会话管理接口 =====

  // Swagger 接口描述：获取当前用户的所有活跃会话列表
  @ApiOperation({ summary: '获取当前登录用户的活跃设备列表' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  // 必须在 :id 路由之前注册，否则会被路由参数吞掉
  @Get('me/sessions')
  getMySessions(@CurrentUser() user: any) {
    return this.userService.getMySessions(user.id);
  }

  // Swagger 接口描述：当前用户主动退出所有设备
  @ApiOperation({ summary: '当前用户退出所有设备（含当前）' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: any, @Res({ passthrough: true }) res: Response) {
    const result = await this.userService.logoutAll(user.id)
    // 清除当前设备的 Cookie
    res.clearCookie('refresh_token', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/v1/user',
    })
    return result
  }

  // Swagger 接口描述：当前用户主动退出指定设备
  @ApiOperation({ summary: '当前用户退出指定会话（其他设备）' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('me/sessions/:sessionId/logout')
  async logoutSession(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: any,
  ) {
    return this.userService.logout(user.id, sessionId)
  }
}
