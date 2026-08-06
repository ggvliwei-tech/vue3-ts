import {
  Controller, // 控制器装饰器
  Get, // GET 请求装饰器
  Post, // POST 请求装饰器
  Body, // 请求体参数装饰器
  UseGuards, Res, // 使用守卫的装饰器
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

/*  // 接口描述：用户登录获取 Token
  @ApiOperation({ summary: '用户登录，获取token' })
  // POST /user/login 路由
  @Post('login')
  // 登录方法：接收 LoginUserDto 作为请求体，校验密码并签发 Token
  login(@Body() loginDto: LoginUserDto) {
    return this.userService.login(loginDto);
  }*/


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



/*  @ApiOperation({ summary: '刷新AccessToken（携带RefreshToken）' })
  @ApiBearerAuth()
  @UseGuards(RefreshTokenGuard)
  @Post('refresh-token')
  refresh(@CurrentUser() user) {
    return this.userService.refreshToken(user.id);
  }*/

  @ApiOperation({ summary: '刷新AccessToken，自动读取Cookie里的Refresh' })
  @Post('refresh-token')
  @UseGuards(RefreshTokenGuard)
  refresh(@CurrentUser() user: any) {
    return this.userService.refreshToken(user.id);
  }


/*  @ApiOperation({ summary: '退出登录，销毁RefreshToken' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@CurrentUser() user) {
    return this.userService.logout(user.id);
  }*/


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
    // 打印当前登录用户信息到控制台
    console.log('当前登录用户', user);
    // 返回所有用户列表
    return this.userService.findAll();
  }
}
