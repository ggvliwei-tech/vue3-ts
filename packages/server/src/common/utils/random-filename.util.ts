import { randomBytes } from 'crypto'
import * as path from 'path'

/**
 * 上传文件的落盘 / 对象存储文件名生成
 *
 * 为什么不能用「时间戳 + Math.random()」：
 *  - `Math.random()` 是伪随机数，V8 用的是可预测的 xorshift128+ 算法，
 *    观察到足够多的历史输出即可反推后续取值；时间戳本身更是完全公开的信息。
 *  - 上传目录是按日期分层的（见 storage 的 dateFolder），加上 `Date.now()` 前缀后，
 *    文件名里唯一不确定的部分就只剩 Math.random() 那一小段。
 *  - 本地存储没有鉴权，URL 一旦泄露（分享链接、Referer、日志）就等于文件公开；
 *    可枚举意味着攻击者能按时间顺序把别人的上传件整个"扫"出来。
 *
 * 换成 `crypto.randomBytes` 后，16 字节 = 128 位熵，枚举在计算上不可行。
 */

/** 随机部分的字节数（16 字节 → 32 位十六进制字符 → 128 位熵） */
const RANDOM_BYTES = 16

/** 扩展名最大长度：合法的图片后缀最长 5 位（.jpeg），留些余量后截断丢弃 */
const MAX_EXT_LENGTH = 10

/**
 * 从原始文件名中提取一个"干净"的扩展名。
 *
 * 不直接信任 `path.extname(originalname)` 的原因：
 *  - 原始文件名是客户端完全可控的字符串，可能带引号、分号、空格等字符，
 *    直接拼进 URL 或后续的 Content-Type 里是多余的攻击面；
 *  - 大小写不统一（.JPG / .PNG）会让同一类文件产生形状不同的 URL。
 *
 * 因此：转小写 → 长度超限或含非 [a-z0-9] 字符 → 直接丢弃扩展名。
 * 丢扩展名不会导致功能问题：文件真实类型由 file.service.ts 的魔术字节嗅探决定，
 * 落库的 mimeType 用的也是嗅探结果。
 *
 * @returns 形如 `.jpg` 的扩展名；无法安全提取时返回空串
 */
export function safeExtname(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase()
  if (!ext || ext.length > MAX_EXT_LENGTH) return ''
  return /^\.[a-z0-9]+$/.test(ext) ? ext : ''
}

/**
 * 生成不可枚举的文件名：32 位随机 hex + 安全的扩展名。
 *
 * 刻意不带时间戳前缀 —— 上传时间已经由存储路径里的 `年/月/日` 目录表达了，
 * 再写进文件名只会额外泄露"精确到秒"的上传时刻。
 *
 * 两个存储实现（local / oss）共用本函数，避免其中一处被改漏。
 */
export function generateRandomFileName(originalName: string): string {
  return `${randomBytes(RANDOM_BYTES).toString('hex')}${safeExtname(originalName)}`
}
