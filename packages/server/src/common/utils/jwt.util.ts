/**
 * JWT 工具函数
 *
 * C5 拆分：从 UserService 抽出 "解析 expiresIn 字符串为秒数" 这类纯工具方法，
 * 供 AuthService / SessionService / 其他模块共享，避免重复实现。
 */
import { ConfigService } from '@nestjs/config'
import { JwtSignOptions } from '@nestjs/jwt'

/**
 * 把 "7d" / "12h" / "30m" / "60s" / "120" 这类字符串转换为秒数
 *  - d: 天 → ×86400
 *  - h: 小时 → ×3600
 *  - m: 分钟 → ×60
 *  - s 或纯数字 → 原值
 */
export function parseJwtExpiry(value: string): number {
  const num = parseInt(value, 10)
  if (Number.isNaN(num)) {
    throw new Error(`非法的 JWT 过期时间配置：${value}`)
  }
  if (value.endsWith('d')) return num * 24 * 60 * 60
  if (value.endsWith('h')) return num * 60 * 60
  if (value.endsWith('m')) return num * 60
  if (value.endsWith('s')) return num
  // 纯数字按秒处理
  return num
}

/**
 * 从 ConfigService 中获取 expiresIn，自动做类型转换
 * 解决 ConfigService.get<string> 返回 string 与 JwtSignOptions['expiresIn'] 的类型冲突
 */
export function getJwtExpiresIn(
  configService: ConfigService,
  key: string,
): JwtSignOptions['expiresIn'] {
  return configService.getOrThrow<string>(key) as JwtSignOptions['expiresIn']
}
