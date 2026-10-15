/**
 * 确认对话框封装
 *
 * 解决 ElMessageBox.confirm 的一个易错点：用户在对话框里点「取消」（或按 ESC、
 * 点遮罩关闭）时，它返回的 Promise 是 **reject** 的，拒绝理由为字符串 'cancel'。
 *
 * 而常见的写法
 *
 *     async function handleDelete(row) {
 *       await ElMessageBox.confirm('确定删除？', '警告', {...})   // ← 在 try 之外
 *       try { await deleteRole(row.id) } catch (e) { ... }
 *     }
 *
 * 会把这个拒绝直接抛出 async 函数。这些 handler 都挂在模板的 @click 上，
 * 没有任何人 catch —— 于是"点了删除又反悔"每次都会在控制台留下一条
 * Uncaught (in promise) cancel。它不致命，但会持续淹没真正的报错，
 * 让人在排查问题时先看到一堆噪音。
 *
 * 这里把「用户点没点确认」和「确认后的业务是否成功」彻底分开：
 * 本函数只回答前者，业务失败仍由调用方自己的 try/catch 负责。
 */
import { ElMessageBox } from 'element-plus'

export interface ConfirmOptions {
  confirmButtonText?: string
  cancelButtonText?: string
  type?: 'warning' | 'info' | 'error' | 'success'
}

/**
 * 弹出确认框。
 * @returns 用户点了确认返回 true；取消 / ESC / 点遮罩关闭一律返回 false
 */
export async function confirmAction(
  message: string,
  title: string,
  options: ConfirmOptions = {},
): Promise<boolean> {
  try {
    await ElMessageBox.confirm(message, title, {
      confirmButtonText: options.confirmButtonText ?? '确定',
      cancelButtonText: options.cancelButtonText ?? '取消',
      type: options.type ?? 'warning',
    })
    return true
  } catch {
    // 'cancel' = 用户主动取消，'close' = 点遮罩 / 关闭按钮。
    // 两者都只是"没确认"，不是错误，不该往外抛。
    return false
  }
}
