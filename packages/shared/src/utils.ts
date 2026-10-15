/**
 * 通用工具函数模块
 * 提供项目中复用的辅助方法
 */

// 导入 dayjs 日期处理库，用于日期格式化和解析
import dayjs from 'dayjs'

/**
 * 获取 API 基础地址
 * @returns 环境变量中配置的基础 URL，未配置时返回空字符串
 */
export function getBaseURL(): string {
  // 从 Vite 环境变量中读取 API 基础地址
  return (import.meta as any).env?.VITE_API_BASE_URL ?? ''
}

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
