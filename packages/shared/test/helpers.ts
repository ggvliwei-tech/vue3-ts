/**
 * 测试公共辅助
 */

/**
 * 构造结构合法（但未签名）的 JWT
 *
 * 需要覆盖 base64url 特有字符时，把 username 设为 '~~~???'：
 * 它会让 payload 的标准 base64 同时出现 `+` 和 `/`，
 * 编码成 base64url 后变成 `-` 和 `_`（普通 ASCII 用户名覆盖不到这条分支）。
 */
export function makeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}
