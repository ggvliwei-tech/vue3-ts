import { NestFactory } from '@nestjs/core'; // NestJS 核心工厂函数，用于创建应用实例
import { NestExpressApplication } from '@nestjs/platform-express'; // Express 平台类型声明，用于类型提示
import { ValidationPipe } from '@nestjs/common'; // 全局参数校验管道，用于 DTO 自动验证
import { ConfigService } from '@nestjs/config'; // 配置服务，用于读取环境变量配置
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'; // Swagger 文档构建工具
import { AppModule } from './app.module'; // 导入根模块
import { HttpExceptionFilter } from './common/filters/http-exception.filter'; // 全局 HTTP 异常过滤器，统一错误响应格式
import { TransformInterceptor } from './common/interceptors/transform.interceptor'; // 全局响应转换拦截器，统一成功响应格式
import cookieParser from 'cookie-parser'; // 导入 cookie-parser 中间件，用于解析和读取 Cookie
async function bootstrap() { // 应用启动入口函数
  const app = await NestFactory.create<NestExpressApplication>(AppModule); // 创建 NestJS 应用实例，指定使用 Express 平台
  const configService = app.get(ConfigService); // 从应用容器中获取 ConfigService 实例

  app.use(cookieParser()); // 使用 cookie-parser 中间件解析 Cookie

  app.setGlobalPrefix('api/v1'); // 设置全局接口前缀，所有路由自动加上 /api/v1

  const allowedOrigins = configService.get<string[]>('CORS_ORIGINS') || []; // 从配置服务读取允许的跨域来源列表
  app.enableCors({ // 启用 CORS 跨域资源共享
    origin: allowedOrigins, // 设置允许的请求来源
    credentials: true, // 允许跨域携带 Cookie 等凭证
  });

  app.useGlobalPipes( // 注册全局参数验证管道，自动验证 DTO 并过滤多余字段
    new ValidationPipe({ // 创建验证管道实例
      whitelist: true, // 白名单模式，自动剔除 DTO 中未定义的字段
      forbidNonWhitelisted: true, // 提交多余字段时抛出错误而非静默忽略
      transform: true, // 自动将请求数据转换为 DTO 类型（如字符串转数字）
    }),
  );

  app.useGlobalInterceptors(new TransformInterceptor()); // 注册全局响应拦截器，将成功响应包装为统一格式 { code, msg, data }

  app.useGlobalFilters(new HttpExceptionFilter()); // 注册全局异常过滤器，捕获 HttpException 并返回统一错误格式

  const swaggerConfig = new DocumentBuilder() // 创建 Swagger 文档构建器实例
    .setTitle('NestJS11 后端接口文档') // 设置文档标题
    .setDescription('Nest11 + TypeORM + MySQL 通用后台模板') // 设置文档描述信息
    .setVersion('1.0') // 设置 API 版本号
    .addBearerAuth() // 添加 Bearer Token 认证支持
    .build(); // 构建并返回 Swagger 配置对象
  const document = SwaggerModule.createDocument(app, swaggerConfig); // 根据配置生成 Swagger 文档对象
  SwaggerModule.setup('api-docs', app, document); // 将 Swagger 文档挂载到 /api-docs 路径

  const port = configService.get<number>('APP_PORT') || 3000; // 从配置读取端口号，默认 3000
  await app.listen(port); // 启动 HTTP 服务器并监听指定端口

  console.log(`服务启动：http://localhost:${port}`); // 打印服务启动地址到控制台
  console.log(`接口基础地址：http://localhost:${port}/api/v1`); // 打印 API 接口基础地址
  console.log(`文档地址：http://localhost:${port}/api-docs`); // 打印 Swagger 文档访问地址
}

bootstrap(); // 执行应用启动函数
