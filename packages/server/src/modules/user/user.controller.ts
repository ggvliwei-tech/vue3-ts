import {
  Controller, // 控制器装饰器
  Get, // GET 请求装饰器
  Post, // POST 请求装饰器
  Body, // 请求体参数装饰器
  UseGuards, Res, Param, // 使用守卫的装饰器 + 路由参数
} from '@nestjs/common';
import type { Response } from 'express'; // Express Response 类型，包含 cookie/clearCookie 等方法
import {
  ApiTags, // Swagger 接口标签
  ApiOperation, // Swagger 接口操作描述
  ApiBearerAuth, // Swagger Bearer Token 认证标识
} from '@nestjs/swagger';
// 用户服务，注入业务逻辑
import { UserService } from './user.service';
// 注册用户 DTO，定义注册请求的数据结构
import { CreateUserDto } from './dto/create-user.dto';
// 登录用户 DTO，定义登录请求的数据结构
import { LoginUserDto } from './dto/login-user.dto';
// JWT 认证守卫，用于保护需要登录的接口
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
// 当前用户装饰器，用于获取 JWT 解析后的用户信息
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RefreshTokenGuard } from '../../common/guards/refresh-token.guard';

// Swagger 标签，将此控制器下的接口归类到 "用户管理模块"
@ApiTags('用户管理模块')
// 设置路由前缀为 /user
@Controller('user')
export class UserController {
  // 构造函数注入用户服务
  constructor(private readonly userService: UserService) {}

  // 接口描述：注册用户
  @ApiOperation({ summary: '注册用户' })
  // POST /user/register 路由
  @Post('register')
  // 注册方法：接收 CreateUserDto 作为请求体，调用 service 创建用户
  register(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  // 接口描述：用户登录，Refresh存入HttpOnly Cookie
  @ApiOperation({ summary: '登录，Refresh存入HttpOnly Cookie' })
  @Post('login')
  async login(
    @Body() dto: LoginUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, userInfo } = await this.userService.login(dto);

    // ========== 写入HttpOnly Cookie ==========
    const isProd = process.env.NODE_ENV === 'production';
    // 用新的refreshToken覆盖原有Cookie，旧Cookie失效
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true, // JS无法读取，核心安全配置
      secure: isProd, // 生产环境HTTPS开启Secure
      sameSite: 'lax', // 防止CSRF
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7天过期，和refresh有效期一致
      path: '/api/v1/user', // 仅刷新、登出接口可携带
  });

    // JSON只返回accessToken给前端
    return { accessToken, userInfo };
  }



  @ApiOperation({ summary: '刷新AccessToken，自动读取Cookie里的Refresh' })
  @Post('refresh-token')
  @UseGuards(RefreshTokenGuard)
  async refresh(
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken: newRefreshToken } = await this.userService.refreshToken(user.id);

    // 用新的 refreshToken 覆盖旧 Cookie，实现 token 轮换
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/user',
    });

    return { accessToken };
  }


  @ApiOperation({ summary: '退出登录：清空Cookie+数据库RefreshToken' })
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.userService.logout(user.id);
    // 清除浏览器Cookie
    res.clearCookie('refresh_token', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/v1/user',
    });
    return { msg: '退出成功' };
  }


  // ===== 以下为需要 JWT 鉴权的接口 =====

  // 接口描述：强制用户下线（管理员功能，无需登录）
  @ApiOperation({ summary: '强制用户下线（管理员功能）' })
  @Post(':id/kick')
  async forceKick(@Param('id') userId: string) {
    return this.userService.forceKick(Number(userId));
  }

  // 接口描述：切换用户状态（启用/禁用，管理员功能，无需登录）
  @ApiOperation({ summary: '切换用户状态（启用/禁用）' })
  @Post(':id/toggle-status')
  async toggleStatus(@Param('id') userId: string) {
    return this.userService.toggleStatus(Number(userId));
  }

  // 接口描述：获取用户列表
  @ApiOperation({ summary: '获取用户列表（需要Token）' })
  // 在 Swagger 文档中显示 Bearer Token 输入框
  @ApiBearerAuth()
  // 挂载 JWT 守卫，请求必须携带有效 Token
  @UseGuards(JwtAuthGuard)
  // GET /user 路由
  @Get()
  // 查询所有用户方法：通过 @CurrentUser() 获取当前登录用户信息
  findAll(@CurrentUser() user: any) {
    // 返回所有用户列表
    return this.userService.findAll();
  }
}
