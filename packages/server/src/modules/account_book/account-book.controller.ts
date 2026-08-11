// 从 @nestjs/common 导入 NestJS 核心装饰器
import {
  Controller,   // 控制器装饰器，定义路由前缀
  Get,          // GET 请求装饰器
  Post,         // POST 请求装饰器
  Body,         // 请求体参数装饰器
  Patch,        // PATCH 请求装饰器，用于部分更新
  Param,        // 路由参数装饰器
  Delete,       // DELETE 请求装饰器
  Query,        // 查询参数装饰器
  UseGuards,    // 使用守卫的装饰器
} from '@nestjs/common';
// 导入 Swagger 相关装饰器，用于 API 文档生成
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
// 导入账本服务，注入业务逻辑
import { AccountBookService } from './account-book.service';
// 导入创建账本 DTO，定义新增请求的数据结构
import { CreateAccountBookDto } from './dto/create-account-book.dto';
// 导入更新账本 DTO，定义修改请求的数据结构
import { UpdateAccountBookDto } from './dto/update-account-book.dto';
// 导入 JWT 认证守卫，用于保护需要登录的接口
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
// 导入当前用户装饰器，用于获取 JWT 解析后的用户信息
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// Swagger 标签，将此控制器下的接口归类到 "账号账本管理"
@ApiTags('账号账本管理')
// 在 Swagger 文档中显示 Bearer Token 认证标识
@ApiBearerAuth()
// 挂载 JWT 守卫，所有接口都必须登录
@UseGuards(JwtAuthGuard)
// 设置路由前缀为 /account-book
@Controller('account-book')
export class AccountBookController {
  // 构造函数注入账本服务
  constructor(private readonly accountBookService: AccountBookService) {}

  // 接口描述：新增账号账本记录
  @Post()
  @ApiOperation({ summary: '新增账号账本记录' })
  // POST /account-book 路由，接收 CreateAccountBookDto 作为请求体
  create(@Body() createDto: CreateAccountBookDto, @CurrentUser() user: any) {
    // 调用服务层创建方法，传入 DTO 和当前用户 ID
    return this.accountBookService.create(createDto, user.id);
  }

  // 接口描述：分页查询所有账本
  @Get()
  @ApiOperation({ summary: '分页查询所有账本' })
  // GET /account-book 路由，支持分页参数
  findAll(
    @Query('page') page = 1,     // 页码，默认第 1 页
    @Query('limit') limit = 10,  // 每页数量，默认 10 条
    @CurrentUser() user: any
  ) {

    // 调用服务层查询方法，传入用户 ID 和分页参数
    return this.accountBookService.findAll(user.id, +page, +limit);
  }

  // 接口描述：根据 ID 查询单条
  @Get(':id')
  @ApiOperation({ summary: '根据ID查询单条' })
  // GET /account-book/:id 路由，根据 ID 查询
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    // 调用服务层查询方法，传入 ID（转为数字）和用户 ID
    return this.accountBookService.findOne(+id, user.id);
  }

  // 接口描述：修改账本记录
  @Patch(':id')
  @ApiOperation({ summary: '修改账本记录' })
  // PATCH /account-book/:id 路由，部分更新
  update(
    @Param('id') id: string,                        // 路由参数，记录 ID
    @Body() updateDto: UpdateAccountBookDto,        // 请求体，更新数据
    @CurrentUser() user: any                             // 当前登录用户
  ) {
    // 调用服务层更新方法，传入 ID、DTO 和用户 ID
    return this.accountBookService.update(+id, updateDto, user.id);
  }

  // 接口描述：删除账本记录
  @Delete(':id')
  @ApiOperation({ summary: '删除账本记录' })
  // DELETE /account-book/:id 路由，删除记录
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    // 调用服务层删除方法，传入 ID（转为数字）和用户 ID
    return this.accountBookService.remove(+id, user.id);
  }
}
