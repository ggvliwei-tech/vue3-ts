/**
 * 全局通用类型定义模块
 * 导出项目中共享的 TypeScript 接口和类型
 */

/**
 * 分页响应数据结构接口
 * 用于统一后端分页接口的返回格式
 * @template T - 列表数据项的类型
 */
export interface PageRes<T> {
    /** 当前页的数据列表 */
    list: T[]
    /** 符合条件的总记录数 */
    total: number
    /** 当前页码（从 1 开始） */
    page: number
    /** 每页显示的记录条数 */
    pageSize: number
}
