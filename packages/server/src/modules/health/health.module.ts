import { Module } from '@nestjs/common'
import { HealthController } from './health.controller'
import { RedisModule } from '../redis/redis.module'

/**
 * 健康检查模块
 * 路由前缀 /health（不走全局 /api/v1 前缀）
 */
@Module({
  imports: [RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}
