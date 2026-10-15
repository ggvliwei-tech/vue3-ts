/**
 * 健康检查端点
 *
 * 端点：
 *  - GET /health          存活探针（liveness）  - 进程是否在跑
 *  - GET /health/ready    就绪探针（readiness） - 依赖（DB/Redis）是否可用
 *
 * 用途：
 *  - K8s livenessProbe / readinessProbe
 *  - Docker HEALTHCHECK
 *  - 负载均衡器后端健康探测
 *  - 运维监控告警
 *
 * 注：路由前缀 /health 而非 /api/v1/health，绕过全局前缀，便于探针直接访问
 */

import { Controller, Get, Logger } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { RedisService } from '../redis/redis.service'

/**
 * 检查结果项
 */
interface CheckResult {
  status: 'up' | 'down'
  latencyMs?: number
  /**
   * 失败原因 —— 只放**面向运维的粗粒度**说明，不放原始异常文本。
   * 见 failReason() 的说明。
   */
  error?: string
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down'
  uptime: number
  timestamp: number
  checks: {
    database: CheckResult
    redis: CheckResult
  }
  version: string
  env: string
}

@Controller('health')
@SkipThrottle() // 健康检查不参与限流
export class HealthController {
  // 启动时间（用于计算 uptime）
  private readonly startTime = Date.now()
  // 应用版本：取自环境变量 APP_VERSION，未设置时回退 '1.0.0'。
  // 注意**不是**从 package.json 读的（仓库里没有构建期注入版本的配置），
  // 所以改 package.json 的 version 不会反映到 /health 上。
  // main.ts 的 Swagger .setVersion() 用的是同一个环境变量。
  private readonly version = process.env.APP_VERSION || '1.0.0'

  private readonly logger = new Logger(HealthController.name)

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  /** 存活探针：仅返回进程是否在跑 */
  @Get()
  liveness() {
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: Date.now(),
      version: this.version,
      env: process.env.NODE_ENV || 'development',
    }
  }

  /** 就绪探针：检查 DB + Redis 是否可用 */
  @Get('ready')
  async readiness(): Promise<HealthResponse> {
    const [dbCheck, redisCheck] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ])

    const allUp = dbCheck.status === 'up' && redisCheck.status === 'up'
    return {
      status: allUp ? 'ok' : 'degraded',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: Date.now(),
      version: this.version,
      env: process.env.NODE_ENV || 'development',
      checks: {
        database: dbCheck,
        redis: redisCheck,
      },
    }
  }

  /**
   * 记录失败详情，并给出可对外返回的粗粒度原因。
   *
   * 本端点**没有鉴权**（探针要能匿名访问，任何能连上端口的人都能 curl），
   * 而 MySQL / Redis 的原始异常文本里通常带着内部信息：
   *   Access denied for user 'vue3_user'@'172.18.0.5' (using password: YES)
   *   getaddrinfo ENOTFOUND redis  /  connect ECONNREFUSED 172.18.0.3:6379
   *   Unknown database 'vue3_monorepo'
   * 直接回传等于把库用户名、内网服务名与 IP、库名一并公开 —— 这些正是攻击者
   * 做横向移动时最先想拿到的信息。所以原始文本只进服务端日志，响应里只给
   * 「哪个依赖挂了」这一个结论；探针本来就只需要知道 up / down。
   */
  private failReason(component: string, err: unknown): string {
    this.logger.error(
      `[Health] ${component} 探活失败: ${(err as Error)?.message}`,
      (err as Error)?.stack,
    )
    return component === 'database' ? '数据库不可用' : '缓存服务不可用'
  }

  /** 数据库探活：执行 SELECT 1 */
  private async checkDatabase(): Promise<CheckResult> {
    const start = Date.now()
    try {
      if (!this.dataSource.isInitialized) {
        return { status: 'down', error: '数据库连接未初始化' }
      }
      await this.dataSource.query('SELECT 1')
      return { status: 'up', latencyMs: Date.now() - start }
    } catch (err) {
      return { status: 'down', error: this.failReason('database', err) }
    }
  }

  /** Redis 探活：执行 PING */
  private async checkRedis(): Promise<CheckResult> {
    const start = Date.now()
    try {
      const pong = await this.redisService.getClient().ping()
      if (pong !== 'PONG') {
        // 响应异常（拿到了非 PONG 的返回值）也算失败，同样不回传原始值
        return { status: 'down', error: this.failReason('redis', new Error(`Unexpected PING response: ${pong}`)) }
      }
      return { status: 'up', latencyMs: Date.now() - start }
    } catch (err) {
      return { status: 'down', error: this.failReason('redis', err) }
    }
  }
}
