/**
 * 滚动到容器底部的组合式函数
 * 配合 Vue nextTick 使用，确保 DOM 更新后再滚动
 */

// 从 vue 中导入 nextTick（DOM 更新后回调）
import { nextTick } from 'vue'

/**
 * 滚动指定容器到底部
 * @param el - 滚动容器的 DOM 引用（ref.value）
 * 会在 nextTick 后执行，确保内容已渲染
 */
export async function useScrollToBottom(el: HTMLElement | null | undefined) {
  // 等待 DOM 更新完成
  await nextTick()
  // 如果容器引用存在，则将滚动位置设为最大高度（即底部）
  if (el) {
    el.scrollTop = el.scrollHeight
  }
}
