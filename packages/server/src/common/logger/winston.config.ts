/**
 * Winston 日志配置
 *
 * 输出：
 *  - 控制台（开发环境，彩色易读）
 *  - 文件：logs/app-{date}.log（所有级别，结构化 JSON）
 *  - 文件：logs/error-{date}.log（仅 error，用于告警采集）
 *
 * 设计要点：
 *  - 用 winston.format.combine 拼接时间戳、错误栈、JSON 输出
 *  - 异步写入（生产可换 stream/transport 提高吞吐）
 *  - 日志目录自动创建
 */

import { utilities as nestWinstonModuleUtilities, WinstonModuleOptions } from 'nest-winston'
import * as winston from 'winston'
import * as fs from 'fs'
import * as path from 'path'

const LOG_DIR = path.resolve(process.cwd(), 'logs')

// 启动时确保日志目录存在（首次启动 logs/ 不存在会报错）
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

/**
 * 生成文件名后缀（YYYY-MM-DD），表示**进程启动那天**
 *
 * 注意它只在模块加载时求值一次，不会随日期推进而变化。
 */
function dateStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 文件 transport（**不是**按日切割，名字里的 daily 只表示文件名带日期前缀）
 *
 * 这里用的是 winston.transports.File，不是 winston-daily-rotate-file：
 *  - 文件名在进程启动时定死为 app-<启动日期>.log，之后**永远不会**换文件。
 *    长期不重启的进程会一直往同一个文件写，日期前缀停留在启动那天（会误导排查）。
 *  - 真正的切割只由 maxsize 触发（20MB 一个），maxFiles 限制保留几个**文件**，
 *    与"天"无关。要按日切割得换成 DailyRotateFile 并配 datePattern。
 */
function dailyFileTransport(filename: string, level: string): winston.transport {
  return new winston.transports.File({
    filename: path.join(LOG_DIR, `${filename}-${dateStamp()}.log`),
    level,
    // 单文件 20MB 自动切分（按大小，不按日期）
    maxsize: 20 * 1024 * 1024,
    // 保留最近 14 个**文件**（≈280MB 上限），不是 14 天。
    // 日志量大时 14 个文件可能只覆盖几小时，别当保留期用。
    maxFiles: 14,
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json(),
    ),
  })
}

export const winstonConfig: WinstonModuleOptions = {
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  // 默认 meta 字段
  defaultMeta: {
    service: 'nest-app',
    env: process.env.NODE_ENV || 'development',
  },
  transports: [
    // ========== 控制台输出（开发友好） ==========
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.ms(),
        nestWinstonModuleUtilities.format.nestLike('NestApp', {
          colors: true,
          prettyPrint: true,
        }),
      ),
    }),

    // ========== 全量日志文件（JSON 格式，方便 ELK/Loki 采集） ==========
    dailyFileTransport('app', 'info'),

    // ========== 错误日志独立文件（用于告警触发） ==========
    dailyFileTransport('error', 'error'),
  ],
}
