/**
 * 共享模块统一导出入口
 * 集中导出 types、request、utils、stores 等公共模块
 * 其他包通过 '@project/shared' 引用此入口
 */

// 导出全局类型定义（如 PageRes 分页类型）
export * from './types'
// 导出 HTTP 请求封装
export * from './request'
// 导出认证状态存储层（token / userInfo 的唯一读写入口）
export * from './auth-storage'
// 导出 token 统一刷新模块（single-flight + 静默续期 + 跨标签同步）
export * from './token-refresh'
// 导出通用工具函数
export * from './utils'
// 导出 Pinia stores（需调用方先 install pinia）
export * from './stores/useAuthStore'
