/**
 * 图片 URL 处理工具
 * 根据环境自动拼接正确的图片访问地址
 */

/**
 * 获取完整的图片 URL
 * @param url - 图片相对路径（如 /api/v1/uploads/common/2026/08/13/xxx.jpg）
 * @returns 完整的图片访问地址
 */
export function getImageUrl(url: string): string {
  // 如果已经是完整 URL（http/https 开头），直接返回
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }

  // 开发环境或代理环境下使用相对路径
  // 生产环境或 App 端使用完整的后端地址
  const baseUrl = (import.meta as any).env?.VITE_API_BASE_URL || ''

  if (baseUrl) {
    // 有基础 URL 时，直接拼接
    return `${baseUrl}${url}`
  }

  // 无基础 URL 时（Vite 代理模式），使用相对路径
  return url
}

/**
 * 批量获取图片 URL
 * @param urls - 图片相对路径数组
 * @returns 完整的图片访问地址数组
 */
export function getImageUrls(urls: string[]): string[] {
  return urls.map(getImageUrl)
}
