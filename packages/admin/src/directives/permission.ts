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

  // 无权限：从父节点摘除。
  // el 可能已经被摘过（见下面 updated 的说明），此时 parentNode 为 null，
  // 可选链直接跳过 —— 本函数是幂等的，重复调用没有副作用。
  el.parentNode?.removeChild(el)
}

/**
 * mounted 之外还必须挂 updated —— 这不是防御性冗余，而是修一个真实缺陷。
 *
 * 只在 mounted 里摘除节点时，被摘掉的元素在 vnode 上仍然记着 `el`。
 * 父组件一旦重渲染（列表排序、翻页、重新加载都会触发），Vue 的 patcher
 * 会拿这个 `el` 去做 insertBefore，把节点**重新插回 DOM** ——
 * 于是本不该出现的权限按钮又冒出来了，而且只在"页面刷新过数据"之后才出现，
 * 现象飘忽、极难复现。
 *
 * Vue 3 的 updated 钩子是 post-render effect，在本次 patch 的所有 DOM 移动
 * **之后**才执行，所以这里再摘一次就能盖住那种情况。
 *
 * 代价是每次组件更新都多跑一次权限判定（一次数组 includes）；
 * 相比"权限按钮时有时无"，这个开销可以忽略。
 *
 * 若将来真遇到因为反复摘节点导致的 insertBefore 报错，
 * 退路是改成给 el 加 `hidden` 属性（语义上是移除，且不动 DOM 结构）——
 * 但那会让开发者工具改个属性就能点回来，不到万不得已不用。
 */
export const permission: Directive<HTMLElement, string | string[]> = {
  mounted: check,
  updated: check,
}

export default permission
