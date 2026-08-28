import { NestFactory } from '@nestjs/core'; // NestJS 核心工厂函数，用于创建应用实例
import { NestExpressApplication } from '@nestjs/platform-express'; // Express 平台类型声明，用于类型提示
import { ValidationPipe } from '@nestjs/common'; // 全局参数校验管道，用于 DTO 自动验证
import { ConfigService } from '@nestjs/config'; // 配置服务，用于读取环境变量配置
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'; // Swagger 文档构建工具
import { AppModule } from './app.module'; // 导入根模块
import { HttpExceptionFilter } from './common/filters/http-exception.filter'; // 全局 HTTP 异常过滤器，统一错误响应格式
import { TransformInterceptor } from './common/interceptors/transform.interceptor'; // 全局响应转换拦截器，统一成功响应格式
import cookieParser from 'cookie-parser'; // 导入 cookie-parser 中间件，用于解析和读取 Cookie
import { networkInterfaces } from 'os'; // Node 内置模块，用于获取本机网络接口信息
/**
 * 收集本机所有可用的 IPv4 地址（排除回环地址 127.0.0.1）
 * 用于在启动日志中同时打印局域网 IP，方便手机/其他设备访问
 */
function getLocalIPv4Addresses(): string[] {
  const interfaces = networkInterfaces()
  const addresses: string[] = []
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      // 仅收集 IPv4，且不是回环地址
      const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
      if (net.family === familyV4Value && !net.internal) {
        addresses.push(net.address)
      }
    }
  }
  return addresses
}
async function bootstrap() { // 应用启动入口函数
  const app = await NestFactory.create<NestExpressApplication>(AppModule); // 创建 NestJS 应用实例，指定使用 Express 平台
  const configService = app.get(ConfigService); // 从应用容器中获取 ConfigService 实例

  app.use(cookieParser()); // 使用 cookie-parser 中间件解析 Cookie

  app.setGlobalPrefix('api/v1'); // 设置全局接口前缀，所有路由自动加上 /api/v1

  const allowedOrigins = configService.get<string[]>('CORS_ORIGINS') || []; // 从配置服务读取允许的跨域来源列表
  app.enableCors({ // 启用 CORS 跨域资源共享
    // origin 支持函数形式：true 表示放行（开发友好），字符串数组表示白名单
    origin: (origin, callback) => {
      // 同源请求（如 curl / SSR）没有 origin 头，直接放行
      if (!origin) return callback(null, true)
      // 白名单命中 → 放行
      if (allowedOrigins.includes(origin)) return callback(null, true)
      // 开发环境兜底：允许所有 192.168.x.x / 10.x.x.x / 172.16-31.x.x / localhost 形式的 LAN 源
      if (process.env.NODE_ENV !== 'production') {
        const lanRegex = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/
        if (lanRegex.test(origin)) return callback(null, true)
      }
      // 生产环境严格按白名单
      callback(new Error(`CORS 拒绝：来源 ${origin} 不在白名单中`), false)
    },
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
  // 0.0.0.0 表示监听所有网卡，这样局域网/容器外都能访问到
  const host = configService.get<string>('APP_HOST') || '0.0.0.0'
  await app.listen(port, host); // 启动 HTTP 服务器，监听指定 host+port

  // ========== 打印启动信息（含 localhost + 局域网 IP + Swagger 文档） ==========
  const localIPs = getLocalIPv4Addresses()
  const env = process.env.NODE_ENV || 'development'
  const divider = '─'.repeat(60)

  console.log('\n' + divider)
  console.log(`🚀  NestJS 服务启动成功 [${env}]`)
  console.log(divider)
  console.log(`  监听地址：${host}:${port}`)
  console.log(`  本机访问：http://localhost:${port}`)
  if (localIPs.length > 0) {
    console.log(`  局域网访问：http://${localIPs[0]}:${port}`)
    if (localIPs.length > 1) {
      console.log(`  其他 IP：  ${localIPs.slice(1).map((ip) => `http://${ip}:${port}`).join('\n             ')}`)
    }
  }
  console.log(`  接口前缀：http://localhost:${port}/api/v1`)
  console.log(`  Swagger： http://localhost:${port}/api-docs`)
  console.log(divider + '\n')
}

bootstrap(); // 执行应用启动函数
