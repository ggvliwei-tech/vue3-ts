import { NestFactory } from '@nestjs/core'; // NestJS 核心工厂函数，用于创建应用实例
import { NestExpressApplication } from '@nestjs/platform-express'; // Express 平台类型声明，用于类型提示
import { ValidationPipe, RequestMethod } from '@nestjs/common'; // 全局参数校验管道 + 请求方法枚举
import { ConfigService } from '@nestjs/config'; // 配置服务，用于读取环境变量配置
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'; // Swagger 文档构建工具
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston'; // nest-winston 提供的 Nest Logger 适配器
import { AppModule } from './app.module'; // 导入根模块
import { GlobalExceptionFilter } from './common/filters/global-exception.filter'; // 全局异常过滤器（catch everything）
import { TransformInterceptor } from './common/interceptors/transform.interceptor'; // 全局响应转换拦截器
import cookieParser from 'cookie-parser'; // 导入 cookie-parser 中间件，用于解析和读取 Cookie
import helmet from 'helmet'; // 安全 HTTP 头（防 XSS/Clickjacking/MIME sniffing）
import compression from 'compression'; // gzip 压缩响应体
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
      const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
      if (net.family === familyV4Value && !net.internal) {
        addresses.push(net.address)
      }
    }
  }
  return addresses
}

async function bootstrap() {
  // 用 nest-winston 替换 NestJS 默认 console logger
  // bufferLogs: true 表示先把日志缓存，等 logger 实例就绪后统一输出
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true })
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER))

  const configService = app.get(ConfigService)
  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER)

  // ========== 安全中间件 ==========
  // helmet：设置安全 HTTP 响应头（X-Frame-Options / X-Content-Type-Options / CSP 等）
  // 注意：helmet 默认 CSP 与 Swagger UI 冲突，需在 dev 关闭 CSP
  app.use(
    helmet({
      contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  )
  // gzip 压缩（生产环境收益明显）
  app.use(compression())
  // Cookie 解析
  app.use(cookieParser())

  // ========== 全局路由前缀（健康检查除外） ==========
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }, { path: 'health/(.*)', method: RequestMethod.GET }],
  })

  // ========== CORS ==========
  const allowedOrigins = configService.get<string[]>('CORS_ORIGINS') || []
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (allowedOrigins.includes(origin)) return callback(null, true)
      if (process.env.NODE_ENV !== 'production') {
        const lanRegex = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/
        if (lanRegex.test(origin)) return callback(null, true)
      }
      callback(new Error(`CORS 拒绝：来源 ${origin} 不在白名单中`), false)
    },
    credentials: true,
  })

  // ========== 全局校验管道 ==========
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  // ========== 全局拦截器 ==========
  app.useGlobalInterceptors(new TransformInterceptor())

  // ========== 全局异常过滤器（catch Everything） ==========
  app.useGlobalFilters(new GlobalExceptionFilter())

  // ========== 优雅关闭 ==========
  // 监听 SIGTERM / SIGINT 信号，先关闭 HTTP 服务再断开 DB/Redis 连接
  app.enableShutdownHooks()

  // ========== Swagger 文档 ==========
  const swaggerConfig = new DocumentBuilder()
    .setTitle('NestJS11 后端接口文档')
    .setDescription('Nest11 + TypeORM + MySQL 通用后台模板')
    .setVersion(process.env.APP_VERSION || '1.0.0')
    .addBearerAuth()
    .build()
  const document = SwaggerModule.createDocument(app, swaggerConfig)
  // 生产环境关闭 Swagger
  if (process.env.NODE_ENV !== 'production') {
    SwaggerModule.setup('api-docs', app, document)
  }

  // ========== 启动服务 ==========
  const port = configService.get<number>('APP_PORT') || 3000
  const host = configService.get<string>('APP_HOST') || '0.0.0.0'
  await app.listen(port, host)

  // ========== 启动横幅（结构化日志） ==========
  const localIPs = getLocalIPv4Addresses()
  const env = process.env.NODE_ENV || 'development'
  logger.log(
    `\n${'─'.repeat(60)}\n` +
      `🚀  NestJS 服务启动成功 [${env}]\n` +
      `${'─'.repeat(60)}\n` +
      `  监听地址：${host}:${port}\n` +
      `  本机访问：http://localhost:${port}\n` +
      (localIPs.length > 0
        ? `  局域网访问：http://${localIPs[0]}:${port}${localIPs.length > 1 ? '\n  其他 IP：  ' + localIPs.slice(1).map((ip) => `http://${ip}:${port}`).join('\n             ') : ''}\n`
        : '') +
      `  健康检查：http://localhost:${port}/health\n` +
      `  健康就绪：http://localhost:${port}/health/ready\n` +
      `  接口前缀：http://localhost:${port}/api/v1\n` +
      `  Swagger： http://localhost:${port}/api-docs\n` +
      `${'─'.repeat(60)}\n`,
  )
}

bootstrap()
