/**
 * HTTP 指标中间件
 *
 * 自动收集每个 HTTP 请求的：
 *  - http_requests_total{method, route, status} Counter
 *  - http_request_duration_ms{method, route} Histogram
 *
 * route 取自 req.route?.path（已匹配的路由模板），
 * 避免被 URL 参数（如 /users/123）污染 label 基数
 */

import { Injectable, NestMiddleware } from '@nestjs/common'
import type { Request, Response, NextFunction } from 'express'
import { MetricsService } from './metrics.service'

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now()
    // 在 res.finish 时记录（请求结束）
    res.on('finish', () => {
      // route.path 在路由匹配后才会有值（health/metrics 控制器也会匹配）
      // 未匹配的（404）使用 '__unknown__' 避免基数爆炸
      const route = (req as any).route?.path
        ? (req as any).baseUrl + (req as any).route.path
        : '__unknown__'
      const labels = {
        method: req.method,
        route,
        status: String(res.statusCode),
      }
      this.metrics.incCounter('http_requests_total', labels)
      this.metrics.observeHistogram(
        'http_request_duration_ms',
        { method: req.method, route },
        Date.now() - start,
      )
    })
    next()
  }
}