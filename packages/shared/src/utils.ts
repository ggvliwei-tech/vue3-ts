/**
 * 通用工具函数模块
 * 提供项目中复用的辅助方法
 */

import dayjs from 'dayjs'

/**
 * 日期格式化
 * @param date 日期值
 * @param format 格式化字符串，默认 'YYYY-MM-DD HH:mm:ss'
 */
export function formatDate(date: dayjs.ConfigType, format = 'YYYY-MM-DD HH:mm:ss'): string {
  return dayjs(date).format(format)
}

/**
 * 生成 UUID
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
