// 从 @nestjs/common 导入 NestJS 核心装饰器
import {
  Controller, // 定义控制器，处理特定路由的请求
  Get, // 定义 GET 请求的路由装饰器
  Post, // 定义 POST 请求的路由装饰器
  Delete, // 定义 DELETE 请求的路由装饰器
  UseInterceptors, // 使用拦截器的装饰器
  UseGuards, // 使用守卫的装饰器
  UploadedFiles, // 获取多文件上传参数的装饰器
  Param, // 获取路由参数的装饰器
  UploadedFile, // 获取单文件上传参数的装饰器
  Query, // 查询参数装饰器
} from '@nestjs/common';
// 从 @nestjs/platform-express 导入文件上传拦截器
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
// 导入文件服务，用于处理具体的文件上传/删除逻辑
import { FileService } from './file.service';
// 导入 JWT 认证守卫
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
// 导入 Swagger 认证标识和操作装饰器
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';

// Swagger 标签
@ApiTags('文件管理')
// 定义路由前缀为 /file，所有该控制器下的接口都会以 /file 开头
@UseGuards(JwtAuthGuard) // 控制器级别守卫，所有接口均需登录
@ApiBearerAuth() // Swagger 显示 Bearer Token 输入框
@Controller('file')
export class FileController {
  // 通过构造函数注入 FileService 服务
  constructor(private readonly fileService: FileService) {}

  // ========== 文件列表（分页） ==========
  @Get()
  @ApiOperation({ summary: '分页查询文件列表' })
  async findAll(
    @Query('page') page = 1, // 页码参数，默认值为 1
    @Query('limit') limit = 10, // 每页数量参数，默认值为 10
    @Query('module') module?: string, // 模块筛选参数，可选
  ) { // 方法参数列表结束
    return this.fileService.findAll(+page, +limit, module); // 调用服务分页查询，+ 将字符串转为数字
  }

  // 单文件（原有）
  // 注册 POST /file/image 路由
  @Post('image')
  // 注册单文件上传拦截器，拦截字段名为 'file'，限制文件大小 5MB
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  // 处理单文件上传的请求，file 为拦截器解析后的文件对象
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    // 调用服务的 uploadSingle 方法上传文件，归类为 'goods' 类型
    // TransformInterceptor 会自动包装为 {code: 0, msg, data} 格式
    return this.fileService.uploadSingle(file, '', true, user.id);
  }

  // ========== 多文件上传 ==========
  // 注册 POST /file/images 路由
  @Post('images')
  // 注册多文件上传拦截器
  @UseInterceptors(
    FilesInterceptor(
      'files', // 前端 formData key 必须为 files
      10, // 最大一次上传数量
      {
        limits: {
          fileSize: 5 * 1024 * 1024, // 单文件5MB
        },
      },
    ),
  )
  // 处理多文件上传的请求，files 为拦截器解析后的文件数组
  async uploadImages(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: any,
  ) {
    // 使用 Promise.all 并发执行所有文件的上传操作，提升效率
    const list = await Promise.all(
      files.map((file) => this.fileService.uploadSingle(file, '', true, user.id)),
    );

    // 返回 URL 数组和完整列表，TransformInterceptor 自动包装
    return {
      urls: list.map((item) => item.url),
      list,
    };
  }

  // 删除
  // 注册 DELETE /file/:id 路由，:id 为路由参数
  @Delete(':id')
  @ApiOperation({ summary: '删除文件' })
  // 处理删除文件的请求，id 为从路由参数中获取的文件 ID
  async remove(@Param('id') id: string) {
    // 将 id 字符串转为数字后调用服务的删除方法
    await this.fileService.deleteFile(+id);
    // TransformInterceptor 自动包装为 {code: 0, msg, data} 格式
    return { msg: '删除成功' };
  }
}
