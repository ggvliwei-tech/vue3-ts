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
 * 生成"日期滚动"文件名后缀（YYYY-MM-DD）
 */
function dateStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 按日切割的文件 transport
 */
function dailyFileTransport(filename: string, level: string): winston.transport {
  return new winston.transports.File({
    filename: path.join(LOG_DIR, `${filename}-${dateStamp()}.log`),
    level,
    // 单文件 20MB 自动切分（不切日期，按大小）
    maxsize: 20 * 1024 * 1024,
    maxFiles: 14, // 保留 14 天
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
