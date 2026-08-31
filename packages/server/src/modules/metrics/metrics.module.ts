/**
 * Prometheus 指标模块
 *
 * 提供：
 *  - GET /metrics         Prometheus 抓取端点（text/plain）
 *  - MetricsService       指标收集服务
 *  - MetricsMiddleware    HTTP 请求自动埋点
 *
 * 路由前缀 /metrics（不走全局 /api/v1），与 /health 一致
 */
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { MetricsController } from './metrics.controller'
import { MetricsService } from './metrics.service'
import { MetricsMiddleware } from './metrics.middleware'

@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsMiddleware],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // 全局 HTTP 指标埋点
    consumer.apply(MetricsMiddleware).forRoutes('*')
  }
}