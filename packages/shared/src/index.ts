/**
 * 共享模块统一导出入口
 * 集中导出 types、request、utils 等公共模块
 * 其他包通过 '@project/shared' 引用此入口
 */

// 导出全局类型定义（如 PageRes 分页类型）
export * from './types'
// 导出 HTTP 请求封装
export * from './request'
// 导出通用工具函数
export * from './utils'
