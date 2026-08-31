/**
 * 通用 try/catch 辅助工具
 *
 * 目标：消除项目里散落的 `catch (e: any) { ElMessage.error(...) }` 重复模式
 *
 * 用法（推荐）：
 * ```ts
 * // 方式 1：解构式，错误时统一 toast
 * const [err, data] = await tryCatch(api.someCall(), { message: '加载失败' })
 * if (err) return  // 已自动 ElMessage.error
 * doSomething(data)
 *
 * // 方式 2：自定义错误处理
 * const [err, data] = await tryCatch(api.someCall(), {
 *   onError: (e) => console.warn('业务可忽略的错误', e),
 * })
 *
 * // 方式 3：完全不处理（仅类型安全）
 * const [err, data] = await tryCatch(api.someCall())
 * if (err) return
 * ```
 */

import { ElMessage } from 'element-plus'

export interface TryCatchOptions {
  /** 失败时 toast 内容（不传则不弹） */
  message?: string
  /** 自定义错误处理（覆盖默认 toast） */
  onError?: (err: unknown) => void
  /** toast 显示类型，默认 'error' */
  toastType?: 'error' | 'warning' | 'info'
}

/**
 * Go-style try/catch：返回 [error, data] 元组
 * - 成功时 err=null, data=真实值
 * - 失败时 err=Error 实例, data=null
 */
export async function tryCatch<T>(
  promise: Promise<T>,
  options: TryCatchOptions = {},
): Promise<[Error | null, T | null]> {
  try {
    const data = await promise
    return [null, data]
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    // 自定义错误处理
    if (options.onError) {
      options.onError(err)
    } else if (options.message) {
      // 默认：ElMessage.error 友好提示
      ElMessage({
        type: options.toastType ?? 'error',
        message: options.message,
      })
    }
    return [err, null]
  }
}

/**
 * 同步版本
 */
export function tryCatchSync<T>(
  fn: () => T,
  options: TryCatchOptions = {},
): [Error | null, T | null] {
  try {
    return [null, fn()]
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    if (options.onError) options.onError(err)
    else if (options.message) {
      ElMessage({
        type: options.toastType ?? 'error',
        message: options.message,
      })
    }
    return [err, null]
  }
}