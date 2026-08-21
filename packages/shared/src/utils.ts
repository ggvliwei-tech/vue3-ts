/**
 * 通用工具函数模块
 * 提供项目中复用的辅助方法
 */

// 导入 dayjs 日期处理库，用于日期格式化和解析
import dayjs from 'dayjs'

/**
 * 日期格式化函数
 * @param date 日期值，支持多种日期格式输入
 * @param format 格式化字符串，默认为 'YYYY-MM-DD HH:mm:ss'
 * @returns 格式化后的日期字符串
 */
export function formatDate(date: dayjs.ConfigType, format = 'YYYY-MM-DD HH:mm:ss'): string {
  // 使用 dayjs 解析日期并按指定格式输出字符串
  return dayjs(date).format(format)
}

/**
 * 生成 UUID 字符串
 * 优先使用浏览器原生的 crypto.randomUUID，否则使用 fallback 实现
 * @returns 符合 UUID v4 格式的字符串
 */
export function generateUUID(): string {
  // 判断当前环境是否支持原生 crypto.randomUUID API
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    // 使用原生 API 生成 UUID，性能更好且更符合标准
    return crypto.randomUUID()
  }
  // fallback 实现：使用模板字符串配合正则替换生成 UUID v4
  // 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx' 是 UUID v4 的模板格式
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    // 生成 0-15 的随机整数
    const r = (Math.random() * 16) | 0
    // 根据字符是 x 还是 y 决定返回值：x 直接取随机数，y 需要设置 UUID v4 的版本位和变体位
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    // 将数值转换为十六进制字符串
    return v.toString(16)
  })
}
