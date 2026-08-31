/**
 * Prometheus metrics 端点
 *
 * 暴露 /metrics（不走 /api/v1 前缀），返回纯文本格式供 Prometheus 抓取
 *
 * 设计：
 *  - GET /metrics 返回 text/plain（Prometheus 抓取格式）
 *  - 与 /health 一样需要免鉴权（探针专用）
 */

import { Controller, Get, Header, Res } from '@nestjs/common'
import type { Response } from 'express'
import { SkipThrottle } from '@nestjs/throttler'
import { MetricsService } from './metrics.service'

@Controller('metrics')
@SkipThrottle() // 监控抓取不限流
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /** Prometheus 抓取端点 */
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(@Res() res: Response): void {
    res.send(this.metrics.dump())
  }
}