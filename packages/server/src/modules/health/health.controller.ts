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

import { Controller, Get } from '@nestjs/common'
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

  /** 数据库探活：执行 SELECT 1 */
  private async checkDatabase(): Promise<CheckResult> {
    const start = Date.now()
    try {
      if (!this.dataSource.isInitialized) {
        return { status: 'down', error: 'DataSource not initialized' }
      }
      await this.dataSource.query('SELECT 1')
      return { status: 'up', latencyMs: Date.now() - start }
    } catch (err) {
      return { status: 'down', error: (err as Error).message }
    }
  }

  /** Redis 探活：执行 PING */
  private async checkRedis(): Promise<CheckResult> {
    const start = Date.now()
    try {
      const pong = await this.redisService.getClient().ping()
      if (pong !== 'PONG') {
        return { status: 'down', error: `Unexpected PING response: ${pong}` }
      }
      return { status: 'up', latencyMs: Date.now() - start }
    } catch (err) {
      return { status: 'down', error: (err as Error).message }
    }
  }
}
