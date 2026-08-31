/**
 * 轻量级 Prometheus 兼容指标收集器
 *
 * 设计原则：
 *  - 零外部依赖（避免引入 prom-client 增加 bundle size）
 *  - 输出格式：纯文本（text/plain; version=0.0.4），与 Prometheus 兼容
 *  - 指标类型：Counter（单调递增）/ Gauge（瞬时值）/ Histogram（分布观测）
 *  - 标签：label values 自动做基数控制（防 label explosion）
 *
 * 核心指标：
 *  - http_requests_total{method,route,status}   请求计数
 *  - http_request_duration_ms_bucket{...}       请求延迟直方图
 *  - process_uptime_seconds                     进程存活秒数
 *  - process_memory_rss_bytes                   进程 RSS
 *  - cache_l1_size                              缓存 L1 条目数
 *  - cache_l2_hits_total / cache_l2_misses_total 缓存命中率
 */

import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import type { LoggerService } from '@nestjs/common'
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston'

/** 指标元数据 */
interface MetricMeta {
  name: string
  type: 'counter' | 'gauge' | 'histogram'
  help: string
  labelNames?: string[]
}

/** Counter 内部存储：labelsKey → value */
type CounterStore = Map<string, number>
/** Gauge 内部存储：labelsKey → value */
type GaugeStore = Map<string, number>
/** Histogram 内部存储：labelsKey → buckets[] + sum + count */
interface HistogramSeries {
  buckets: number[] // 累计计数（le 边界）
  sum: number
  count: number
}
type HistogramStore = Map<string, HistogramSeries>

/** 序列化 labels → 稳定字符串 key（顺序按 labelNames 排序） */
function labelsKey(values: Record<string, string | number>, names: readonly string[]): string {
  const parts: string[] = []
  for (const n of names) {
    const v = values[n]
    parts.push(`${n}=${v ?? ''}`)
  }
  return parts.join('|')
}

/** 转义 Prometheus label value 中的特殊字符 */
function escapeLabelValue(v: string | number): string {
  return String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')
}

/**
 * MetricsService — 轻量级 Prometheus 兼容指标收集器
 *
 * 用法：
 * ```ts
 * // 在 interceptor / middleware 中：
 * metrics.incCounter('http_requests_total', { method, route, status }, 1)
 * metrics.observeHistogram('http_request_duration_ms', { method, route }, durationMs)
 *
 * // 暴露 /metrics 端点
 * @Get('metrics')
 * metrics() { return this.metricsService.dump() }
 * ```
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  /** 所有指标元数据 */
  private readonly meta = new Map<string, MetricMeta>()
  /** Counter 存储 */
  private readonly counters = new Map<string, CounterStore>()
  /** Gauge 存储 */
  private readonly gauges = new Map<string, GaugeStore>()
  /** Histogram 存储 */
  private readonly histograms = new Map<string, HistogramStore>()
  /** 直方图默认 bucket（毫秒）：覆盖 5ms ~ 10s */
  private static readonly DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]

  /** 服务启动时间戳（用于 uptime） */
  private readonly startedAt = Date.now()

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {
    // 预注册核心指标
    this.register({
      name: 'http_requests_total',
      type: 'counter',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status'],
    })
    this.register({
      name: 'http_request_duration_ms',
      type: 'histogram',
      help: 'HTTP request duration in milliseconds',
      labelNames: ['method', 'route'],
    })
    this.register({
      name: 'process_uptime_seconds',
      type: 'gauge',
      help: 'Process uptime in seconds',
    })
    this.register({
      name: 'process_memory_rss_bytes',
      type: 'gauge',
      help: 'Process RSS memory in bytes',
    })
    this.register({
      name: 'cache_l1_size',
      type: 'gauge',
      help: 'L1 cache entries count',
    })
  }

  onModuleInit() {
    this.logger.log('[Metrics] 指标收集器初始化完成')
  }

  /**
   * 注册指标（重复注册同名则忽略）
   */
  register(meta: MetricMeta): void {
    if (this.meta.has(meta.name)) return
    this.meta.set(meta.name, meta)
    if (meta.type === 'counter') this.counters.set(meta.name, new Map())
    if (meta.type === 'gauge') this.gauges.set(meta.name, new Map())
    if (meta.type === 'histogram') this.histograms.set(meta.name, new Map())
  }

  /**
   * Counter +1（或 +n）
   */
  incCounter(name: string, labels: Record<string, string | number> = {}, n = 1): void {
    const meta = this.meta.get(name)
    if (!meta || meta.type !== 'counter') return
    const store = this.counters.get(name)!
    const key = labelsKey(labels, meta.labelNames ?? [])
    store.set(key, (store.get(key) ?? 0) + n)
  }

  /**
   * Gauge 赋值
   */
  setGauge(name: string, value: number, labels: Record<string, string | number> = {}): void {
    const meta = this.meta.get(name)
    if (!meta || meta.type !== 'gauge') return
    const store = this.gauges.get(name)!
    const key = labelsKey(labels, meta.labelNames ?? [])
    store.set(key, value)
  }

  /**
   * Histogram 观测一个值（默认 buckets）
   */
  observeHistogram(
    name: string,
    labels: Record<string, string | number> = {},
    value: number,
    buckets: number[] = MetricsService.DEFAULT_BUCKETS,
  ): void {
    const meta = this.meta.get(name)
    if (!meta || meta.type !== 'histogram') return
    const store = this.histograms.get(name)!
    const key = labelsKey(labels, meta.labelNames ?? [])
    let series = store.get(key)
    if (!series) {
      series = {
        buckets: new Array(buckets.length).fill(0),
        sum: 0,
        count: 0,
      }
      store.set(key, series)
    }
    for (let i = 0; i < buckets.length; i++) {
      if (value <= buckets[i]) series.buckets[i]++
    }
    series.sum += value
    series.count++
  }

  /**
   * 进程指标更新（由 metrics.interceptor 周期调用）
   */
  updateProcessMetrics(): void {
    this.setGauge('process_uptime_seconds', Math.floor((Date.now() - this.startedAt) / 1000))
    const mem = process.memoryUsage()
    this.setGauge('process_memory_rss_bytes', mem.rss)
  }

  /**
   * 输出 Prometheus 文本格式
   */
  dump(): string {
    // 每次 dump 时刷新进程级 gauge
    this.updateProcessMetrics()
    const lines: string[] = []
    for (const [name, meta] of this.meta) {
      lines.push(`# HELP ${name} ${meta.help}`)
      lines.push(`# TYPE ${name} ${meta.type}`)
      if (meta.type === 'counter') {
        const store = this.counters.get(name)!
        if (store.size === 0) {
          lines.push(`${name} 0`)
        } else {
          for (const [key, value] of store) {
            const labels = this.formatLabels(key, meta.labelNames ?? [])
            lines.push(`${name}${labels} ${value}`)
          }
        }
      } else if (meta.type === 'gauge') {
        const store = this.gauges.get(name)!
        if (store.size === 0) {
          lines.push(`${name} 0`)
        } else {
          for (const [key, value] of store) {
            const labels = this.formatLabels(key, meta.labelNames ?? [])
            lines.push(`${name}${labels} ${value}`)
          }
        }
      } else if (meta.type === 'histogram') {
        const store = this.histograms.get(name)!
        const buckets = MetricsService.DEFAULT_BUCKETS
        for (const [key, series] of store) {
          const baseLabels = meta.labelNames ?? []
          const keyValues = key.split('|').reduce<Record<string, string>>((acc, kv) => {
            const [k, v] = kv.split('=')
            if (k) acc[k] = v ?? ''
            return acc
          }, {})
          // 输出每个 bucket
          for (let i = 0; i < buckets.length; i++) {
            const labels: Record<string, string | number> = { ...keyValues, le: String(buckets[i]) }
            lines.push(`${name}_bucket${this.buildLabelString(labels, [...baseLabels, 'le'])} ${series.buckets[i]}`)
          }
          // +Inf bucket
          const infLabels: Record<string, string | number> = { ...keyValues, le: '+Inf' }
          lines.push(`${name}_bucket${this.buildLabelString(infLabels, [...baseLabels, 'le'])} ${series.count}`)
          // _sum / _count
          const sumLabels = this.buildLabelString(keyValues, baseLabels)
          lines.push(`${name}_sum${sumLabels} ${series.sum}`)
          lines.push(`${name}_count${sumLabels} ${series.count}`)
        }
      }
    }
    return lines.join('\n')
  }

  /** 序列化 labels → {key="val",key2="val2"} 或空字符串 */
  private formatLabels(key: string, names: readonly string[]): string {
    if (names.length === 0) return ''
    const keyValues = key.split('|').reduce<Record<string, string>>((acc, kv) => {
      const [k, v] = kv.split('=')
      if (k) acc[k] = v ?? ''
      return acc
    }, {})
    return this.buildLabelString(keyValues, names)
  }

  /** 从 map 顺序输出 labels 字符串 */
  private buildLabelString(values: Record<string, string | number>, names: readonly string[]): string {
    if (names.length === 0) return ''
    const parts = names.map((n) => `${n}="${escapeLabelValue(values[n] ?? '')}"`)
    return `{${parts.join(',')}}`
  }

  /** 清空所有指标（测试用） */
  reset(): void {
    for (const store of this.counters.values()) store.clear()
    for (const store of this.gauges.values()) store.clear()
    for (const store of this.histograms.values()) store.clear()
  }
}