/**
 * 全局自定义指令的类型声明
 *
 * 让 <van-button v-permission="'file:delete'"> 在模板里获得类型检查，
 * 避免把权限码写成对象或数字这类明显错误的类型。
 */
import type { Directive } from 'vue'

declare module 'vue' {
  export interface ComponentCustomProperties {
    /** 按钮级权限指令：传单个权限码或权限码数组（拥有任一即展示） */
    vPermission: Directive<HTMLElement, string | string[]>
  }
}

export {}
