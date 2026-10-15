/**
 * 令牌版本号（用户级吊销）的解析与判定
 *
 * 背景见 common/constants/auth-keys.ts 里 tokenVersion 的说明。简单说：
 * 踢某用户「全部设备」时把 `auth:ver:{userId}` 递增，签发 access token 时
 * 把当时的版本号写进 payload.tokenVersion；校验时 payload 里的版本只要
 * **小于**当前版本，就说明这个令牌签发于某次全量吊销之前，应当拒绝。
 *
 * 抽成纯函数是为了让「守卫」和「SessionService」共用同一套解析规则 ——
 * 两边各写一遍 Number(raw) 很容易在默认值/脏数据上产生分歧，
 * 而这类分歧的表现是"限流与吊销时灵时不灵"，极难排查。
 */

/**
 * 解析 Redis 中存的版本号。
 *
 * 键不存在（从未被全量吊销过）→ 0，即初值。
 * 内容被写脏（非数字）时同样退回 0，这是有意选择的 fail-open：此时
 * currentVersion=0，而任何被正常签发的令牌版本号都 ≥ 0，比较结果恒为
 * 「未吊销」，相当于吊销功能暂时失灵。反过来的 fail-closed（例如把脏值
 * 当成一个大数）会让该用户手上所有正常令牌立刻失效、直接锁死，代价更大。
 * 何况这个键的唯一写入路径是自增，脏值不是正常流程能产生的状态。
 */
export function parseTokenVersion(raw: string | null | undefined): number {
  if (!raw) return 0
  const version = parseInt(raw, 10)
  return Number.isFinite(version) && version >= 0 ? version : 0
}

/**
 * 判断令牌是否因「全量吊销」而失效。
 *
 * @param payloadVersion token 里携带的版本号（旧令牌可能没有该字段，按 0 处理）
 * @param currentVersion Redis 中的当前版本号
 */
export function isTokenRevoked(
  payloadVersion: unknown,
  currentVersion: number,
): boolean {
  return parseTokenVersion(
    payloadVersion === null || payloadVersion === undefined
      ? null
      : String(payloadVersion),
  ) < currentVersion
}
