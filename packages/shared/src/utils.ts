/**
 * 通用工具函数模块
 * 提供项目中复用的辅助方法
 */

// 导入 dayjs 日期处理库，用于日期格式化和解析
import dayjs from 'dayjs'

/**
 * 获取 API 基础地址
 * @returns 环境变量中配置的基础 URL，未配置时返回空字符串
 */
export function getBaseURL(): string {
  // 从 Vite 环境变量中读取 API 基础地址
  return import.meta.env?.VITE_API_BASE_URL ?? ''
}

/**
 * 日期格式化函数
 * @param date 日期值，支持多种日期格式输入
 * @param format 格式化字符串，默认为 'YYYY-MM-DD HH:mm:ss'
 * @returns 格式化后的日期字符串
 */
export function formatDate(date: dayjs.ConfigType, format = 'YYYY-MM-DD HH:mm:ss'): string {
  // 使用 dayjs 解析日期并按指定格式输出字符串
  return dayjs(date).format(format)
}

/**
 * 校验登录后跳转目标，只放行站内路径。
 *
 * `?redirect=` 的值来自 URL，用户可以任意构造，而它会被直接交给 router.push：
 *  - `//evil.com` 是协议相对地址。router.push 会走到 history.pushState，
 *    浏览器的同源检查随即抛 SecurityError —— 用户已登录成功却卡在登录页，
 *    控制台报错，看起来像"登录没反应"。
 *  - 完整外链（`https://evil.com`）不以 / 开头，被 vue-router 当作相对路径，
 *    解析成 `/https://evil.com` 这种不存在的路由，落到 404 页。
 *  - 更要紧的是未来：一旦有人把 router.push 改成 window.location.href
 *    （很常见的改动），`//evil.com` 就立刻变成真正的开放重定向。
 *    在这里卡住，对现在的行为和将来的改动都安全。
 *
 * 判定规则：必须以单个 `/` 开头，且不能是 `//` 或 `/\`（协议相对地址的两种写法）。
 */
export function safeRedirectPath(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || raw === '') return fallback
  if (!raw.startsWith('/')) return fallback
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  return raw
}

/**
 * 等待 promise settle，但最多等 timeoutMs；超时则提前放行（**不取消**原 promise）。
 *
 * 用途是给「启动时必须等、但绝不该无限等」的前置请求兜底。
 * 以 admin / app 的 `main.ts` 为例：挂载前要先拉一次 profile 刷新权限，
 * 否则首屏会用陈旧权限渲染。但 axios 默认超时 15s，后端慢或不可达时
 * 用户盯着的是 15 秒白屏 —— 连登录页都出不来。
 *
 * 注意这里只做「提前放行」，不会 abort 原请求：它可能仍在后台完成并正常
 * 写回 store，这是期望行为（权限稍后到位总比永远不到好）。调用方若需要
 * 感知超时，通过 onTimeout 回调处理。
 */
export function settleWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      onTimeout?.()
      resolve()
    }, timeoutMs)
    // 成功与失败都算 settle —— 这个函数的职责是"别再等了"，不是转发结果
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    promise.then(done, done)
  })
}

/**
 * 复制文本到剪贴板。
 *
 * navigator.clipboard 只在**安全上下文**（HTTPS 或 localhost）下存在。
 * 通过局域网 IP 访问时（http://192.168.x.x:5173 —— 本项目 dev 脚本带 --host，
 * 手机真机联调正是这个场景）它是 undefined。旧写法
 * `if (navigator.clipboard) { navigator.clipboard.writeText(...) }` 会在这时
 * **静默什么都不做**：用户点了复制，页面毫无反应也不报错，看起来像按钮坏了。
 * 所以这里保留 execCommand 兜底，并把结果作为返回值交回调用方去提示。
 *
 * @returns 是否复制成功
 */
export async function copyText(text: string): Promise<boolean> {
  // 首选异步剪贴板 API
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 权限被拒（用户点了"不允许"）或文档未聚焦 —— 继续尝试兜底方案
    }
  }

  // 兜底：execCommand('copy')。已被标记为废弃，但在不安全上下文下仍是唯一可用的手段。
  const textarea = document.createElement('textarea')
  textarea.value = text
  // readonly 防止移动端弹出软键盘；固定定位 + 透明避免插入瞬间页面跳动
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  try {
    textarea.select()
    // iOS Safari 只认显式设置的选区，不设的话 select() 不生效
    textarea.setSelectionRange(0, textarea.value.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    // 无论成败都要摘掉，否则复制失败会在 DOM 里堆一个游离的 textarea
    document.body.removeChild(textarea)
  }
}
