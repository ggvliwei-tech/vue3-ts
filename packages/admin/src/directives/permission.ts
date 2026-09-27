/**
 * v-permission 按钮级权限指令（admin 端）
 *
 * 用法：
 *   <el-button v-permission="'user:delete'">删除</el-button>
 *   <el-button v-permission="['user:update', 'user:delete']">操作</el-button>  // 拥有任一即可
 *
 * 无权限时直接把元素从 DOM 中移除（而非 display:none），
 * 避免用户通过开发者工具改样式就能点到按钮。
 *
 * 此前后台只有路由级权限校验，页面内的操作按钮对所有人可见，
 * 点了才被后端 403 拒绝 —— 既是体验问题，也暴露了功能结构。
 *
 * 仍需强调：这只是体验层，后端 PermissionsGuard 才是安全边界。
 */
import type { Directive, DirectiveBinding } from 'vue'
import { useAuthStore } from '@project/shared/stores/useAuthStore'

/** 校验并在无权限时移除元素 */
function check(el: HTMLElement, binding: DirectiveBinding<string | string[]>) {
  const value = binding.value
  // 未传值视为不限制，直接放行（避免误写导致按钮全部消失）
  if (!value) return

  const required = Array.isArray(value) ? value : [value]
  if (required.length === 0) return

  // 拥有任一权限码即可展示
  if (useAuthStore().hasAnyPermission(required)) return

  // 无权限：从父节点摘除
  el.parentNode?.removeChild(el)
}

export const permission: Directive<HTMLElement, string | string[]> = {
  mounted: check,
}

export default permission
