// NestJS 核心工厂函数，用于创建应用实例
import { NestFactory } from '@nestjs/core';
// Express 平台类型声明，用于类型提示
import { NestExpressApplication } from '@nestjs/platform-express';
// 全局参数校验管道，用于 DTO 自动验证
import { ValidationPipe } from '@nestjs/common';
// 配置服务，用于读取环境变量配置
import { ConfigService } from '@nestjs/config';
// Swagger 文档构建工具
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
// 根模块
import { AppModule } from './app.module';
// 全局 HTTP 异常过滤器，统一错误响应格式
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
// 全局响应转换拦截器，统一成功响应格式
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
// 导入 cookie-parser 中间件，用于解析和读取 Cookie
import cookieParser from 'cookie-parser';
// 导入路径拼接工具
import { join } from 'path';
// 导入文件系统模块
import * as fs from 'fs';


// 应用启动入口函数
async function bootstrap() {
  // 创建 NestJS 应用实例，指定使用 Express 平台
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // 从应用容器中获取 ConfigService 实例
  const configService = app.get(ConfigService);

  // 使用 cookie-parser 中间件解析 Cookie
  app.use(cookieParser())


  // 全局上传配置
  const uploadPath = join(__dirname, '../uploads');

  // 文件夹不存在自动创建
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
  }

  // 静态资源访问：可以通过 http://域名/api/v1/uploads/xxx 访问图片
  app.useStaticAssets(uploadPath, {
    prefix: '/api/v1/uploads',
  });

  // 设置全局接口前缀，所有路由自动加上 /api/v1
  app.setGlobalPrefix('api/v1');

  // 开启全局 CORS 跨域支持，允许前端跨域访问
  app.enableCors({
    origin:true,
    credentials:true// 允许跨域携带Cookie
  });

  // 注册全局参数校验管道，自动验证 DTO 并过滤多余字段
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,            // 白名单模式，自动剔除 DTO 中未定义的字段
      forbidNonWhitelisted: true, // 当提交多余字段时抛出错误而非静默忽略
      transform: true,            // 自动将请求数据转换为 DTO 类型（如字符串转数字）
    }),
  );

  // 注册全局响应拦截器，将所有成功响应包装为统一格式 { code, msg, data }
  app.useGlobalInterceptors(new TransformInterceptor());

  // 注册全局异常过滤器，捕获 HttpException 并返回统一错误格式 { code, msg, data }
  app.useGlobalFilters(new HttpExceptionFilter());

  // 配置 Swagger 接口文档
  const swaggerConfig = new DocumentBuilder()
    .setTitle('NestJS11 后端接口文档')   // 文档标题
    .setDescription('Nest11 + TypeORM + MySQL 通用后台模板') // 文档描述
    .setVersion('1.0')                    // 版本号
    .addBearerAuth()                      // 添加 Bearer Token 认证支持（用于需要 JWT 的接口）
    .build();
  // 根据配置生成 Swagger 文档描述文件
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // 将 Swagger 文档挂载到 /api-docs 路径，可通过浏览器访问
  SwaggerModule.setup('api-docs', app, document);

  // 从环境变量读取端口号，默认 3000
  const port = configService.get<number>('APP_PORT') || 3000;
  // 启动 HTTP 服务器监听指定端口
  await app.listen(port);

  // 打印启动信息到控制台
  console.log(`服务启动：http://localhost:${port}`);
  console.log(`接口基础地址：http://localhost:${port}/api/v1`);
  console.log(`文档地址：http://localhost:${port}/api-docs`);
}

// 执行启动函数
bootstrap();
