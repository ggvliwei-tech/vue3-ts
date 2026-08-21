/**
 * 图片 URL 处理工具
 * 根据环境自动拼接正确的图片访问地址
 */

// 从共享模块中导入 getBaseURL 函数
import { getBaseURL } from '@project/shared'

/**
 * 获取完整的图片 URL
 * @param url - 图片相对路径（如 /api/v1/uploads/common/2026/08/13/xxx.jpg）
 * @returns 完整的图片访问地址
 */
export function getImageUrl(url: string): string {
  // 如果传入的 url 已经是完整的 http 或 https 协议的 URL，则直接返回
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }

  // 获取环境变量中配置的基础 API 地址
  const baseUrl = getBaseURL()

  // 如果存在基础 URL（如生产环境），则将其与相对路径拼接成完整 URL
  if (baseUrl) {
    return `${baseUrl}${url}`
  }

  // 无基础 URL 时（Vite 代理模式），使用相对路径
  // 在开发环境中，Vite 会将相对路径的 API 请求代理到后端
  return url
}

/**
 * 批量获取图片 URL
 * @param urls - 图片相对路径数组
 * @returns 完整的图片访问地址数组
 */
export function getImageUrls(urls: string[]): string[] {
  // 使用 map 方法对数组中的每个 URL 调用 getImageUrl 函数进行处理
  return urls.map(getImageUrl)
}
