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
import { checkProductionEnv, formatProductionEnvIssues } from './config/production-env.util'; // 生产环境配置自检
import { isOriginAllowed } from './common/utils/cors.util'; // CORS 来源判定（与 WS 网关共用）

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
  // ========== 生产环境配置自检（必须排在最前面） ==========
  // 放在 NestFactory.create 之前：此时还没连数据库/Redis，密钥有问题可以立刻退出，
  // 不必先建连接再回滚。另外此时 winston logger 尚未就绪，只能用 console 输出。
  const envCheck = checkProductionEnv()
  if (envCheck.errors.length > 0) {
    console.error(formatProductionEnvIssues(envCheck))
    process.exit(1)
  }
  if (envCheck.warnings.length > 0) {
    console.warn(formatProductionEnvIssues(envCheck))
  }

  // 用 nest-winston 替换 NestJS 默认 console logger
  // bufferLogs: true 表示先把日志缓存，等 logger 实例就绪后统一输出
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true })
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER))

  const configService = app.get(ConfigService)
  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER)

  // ========== 反向代理信任链（必须在读 req.ip 之前设置） ==========
  // 本项目的部署形态是 nginx 反代，nginx 的 `$proxy_add_x_forwarded_for` 会在
  // 客户端传来的 X-Forwarded-For 后面**追加**真实来源，真值在最右边：
  //     客户端伪造  X-Forwarded-For: 1.2.3.4
  //     nginx 转发  X-Forwarded-For: 1.2.3.4, 5.6.7.8   ← 5.6.7.8 才是真的
  //
  // 不设 trust proxy 时 Express 完全忽略 XFF，req.ip 恒等于「上一跳」的地址 ——
  // 容器部署下就是 nginx 容器的内网 IP，全站用户共用一个限流桶；
  // 设成 true 则走到另一个极端：原样采信最左边的值，等于让客户端自己决定限流键。
  // 只有数字 1（信任 1 跳）能从右往左跳过 nginx、取到那个追加进去的真实来源，
  // 客户端伪造的前缀会被丢弃。全局 ThrottlerGuard 用的也是 req.ip，一处生效两处受益。
  //
  // ⚠️ 前提是后端只能经 nginx 访问：若能直连本服务，攻击者可以自己伪造整条 XFF 链。
  // 这也是 docker-compose 把 3000 端口绑到 127.0.0.1 的原因。
  app.set('trust proxy', 1)

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

  // ========== 全局路由前缀（探针端点除外） ==========
  // health 与 metrics 都是运维/探针专用：前者给 K8s 探针，后者给 Prometheus 抓取。
  // 二者都必须在排除清单里 —— MetricsController 与 MetricsModule 的注释都写明
  // 「不走 /api/v1 前缀」，若这里漏排，实际注册路径会变成 /api/v1/metrics，
  // Prometheus 按 /metrics 抓取会静默拿到 404（监控失效且不报错）。
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/(.*)', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  })

  // ========== CORS ==========
  // 判定逻辑与 chat.gateway.ts 的 WebSocket 网关共用（common/utils/cors.util.ts）：
  // 两条链路曾经各维护一份白名单，WS 那份还停留在硬编码开发端口上，生产必错。
  const allowedOrigins = configService.get<string[]>('CORS_ORIGINS') || []
  app.enableCors({
    origin: (origin, callback) =>
      isOriginAllowed(origin, allowedOrigins, process.env.NODE_ENV)
        ? callback(null, true)
        : callback(new Error(`CORS 拒绝：来源 ${origin} 不在白名单中`), false),
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
  const isProd = env === 'production'

  // 端口与 compose 里的 backend 冲突时给出明确提示。
  // Windows 下 0.0.0.0:3000 与 127.0.0.1:3000 能同时监听，进程不会报错，
  // 但 localhost:3000（浏览器/代理默认目标）命中的是 Docker 那个后端，
  // 于是「明明是刚改的代码却不生效」「本地后端日志一条没有」这类假故障。
  if (!isProd && port === 3000) {
    logger.warn(
      '⚠️  APP_PORT=3000 与 docker compose 中 backend 发布的 127.0.0.1:3000 重叠。' +
        '浏览器访问 localhost:3000 会命中 Docker 后端而非本进程；' +
        '本地调试请在 packages/server/.env.local 写 APP_PORT=3001，' +
        '并让前端 .env.local 的 VITE_API_TARGET 指向 http://127.0.0.1:3001。',
    )
  }

  // 本地调试时把依赖地址打进横幅：连的还是容器映射端口（MySQL 3307 / Redis 6380 /
  // Chroma 8001）一眼可辨，省得 500 之后再去翻 .env 猜连的是哪个库。
  const dependencies = isProd
    ? ''
    : `  MySQL：   ${configService.get<string>('DB_HOST')}:${configService.get<number>('DB_PORT')} / ${configService.get<string>('DB_NAME')}\n` +
      `  Redis：   ${configService.get<string>('REDIS_HOST') ?? '127.0.0.1'}:${configService.get<number>('REDIS_PORT') ?? 6379}\n` +
      `  Chroma：  ${process.env.CHROMA_HOST ?? '127.0.0.1'}:${process.env.CHROMA_PORT ?? 8000}\n`

  logger.log(
    `\n${'─'.repeat(60)}\n` +
      `🚀  NestJS 服务启动成功 [${env}]\n` +
      `${'─'.repeat(60)}\n` +
      `  监听地址：${host}:${port}\n` +
      `  本机访问：http://localhost:${port}\n` +
      dependencies +
      (localIPs.length > 0
        ? `  局域网访问：http://${localIPs[0]}:${port}${localIPs.length > 1 ? '\n  其他 IP：  ' + localIPs.slice(1).map((ip) => `http://${ip}:${port}`).join('\n             ') : ''}\n`
        : '') +
      `  健康检查：http://localhost:${port}/health\n` +
      `  健康就绪：http://localhost:${port}/health/ready\n` +
      `  监控指标：http://localhost:${port}/metrics\n` +
      `  接口前缀：http://localhost:${port}/api/v1\n` +
      `  Swagger： http://localhost:${port}/api-docs\n` +
      `${'─'.repeat(60)}\n`,
  )
}

bootstrap()
