/**
 * 认证 / 会话相关的 Redis Key 定义
 *
 * 集中管理的原因：这些 key 此前散落在 SessionService、RefreshTokenGuard、
 * JwtAuthGuard、AuthService 四处手工拼接字符串，并且已经漂移出过 bug ——
 * 旧代码里残留着 `refresh:token:{userId}`（无 sessionId 后缀）这种历史格式，
 * 与实际写入的 `refresh:token:{userId}:{sessionId}` 不一致，
 * 导致"吊销 RT"的操作静默删不掉任何东西。
 *
 * 约定：新增或修改 key 格式时只改这一处。
 */
export const AuthKeys = {
  /** 单设备 RefreshToken，TTL 与 refresh token 有效期一致 */
  refreshToken: (userId: number, sessionId: string) =>
    `refresh:token:${userId}:${sessionId}`,

  /**
   * 上一个 RefreshToken，仅保留 RT_ROTATION_GRACE_SECONDS 秒。
   *
   * 用途：容忍「并发刷新」。RT 每次刷新都必须轮换，而同一浏览器的多个标签页
   * 可能几乎同时用同一个 RT 发起刷新 —— 先处理完的那个已经把 Redis 里的 RT 换掉了，
   * 后到的请求带着旧 RT 就会被复用检测判为盗用，直接把用户踢下线。
   * 轮换时把被替换的 RT 暂存于此，命中即视为合法并发（见 RefreshTokenGuard）。
   */
  previousRefreshToken: (userId: number, sessionId: string) =>
    `refresh:prev:${userId}:${sessionId}`,

  /** 用户会话元数据 Hash，field = sessionId，value = JSON(SessionInfo) */
  session: (userId: number) => `session:${userId}`,

  /**
   * 设备级黑名单：仅让「单个设备」的 access token 立即失效
   * 场景：RT 复用检测命中、踢指定设备
   * 会话粒度是有意为之：一台设备出问题不该把该用户其他设备一起踢下线。
   */
  blacklistSession: (userId: number, sessionId: string) =>
    `blacklist:session:${userId}:${sessionId}`,

  /**
   * 用户令牌版本号：单调递增的整数，踢该用户「全部设备」时 +1。
   * 场景：forceKick 不传 sessionId、logout-all、禁用用户、改密码
   *
   * 签发 access token 时把当时的版本号写进 payload.tokenVersion，
   * 校验时只要 payload 里的版本 < 当前版本，就说明这个令牌签发于某次
   * 「全部设备下线」之前，直接拒绝。
   *
   * 为什么不用「用户级黑名单布尔值」（旧实现）：
   * 旧键 `blacklist:token:{userId}` 是"有没有被踢过"的开关，而登录成功必须把它
   * 删掉，否则刚签发的新令牌也会被同一个键拦下、用户 15 分钟内谁都登不进来。
   * 于是产生了这样一个漏洞链路：管理员踢掉该用户全部设备（例如怀疑令牌泄露）
   * → 用户随后正常登录一次 → 旧黑名单被清除 → **此前被吊销的那些 access token
   * 全部复活**，在各自剩余有效期内继续可用。吊销被别人的一次登录撤销了。
   * 版本号方案没有这个共享开关，登录无需清理任何东西：新令牌版本号天然等于当前值。
   *
   * 刻意**不设过期时间**：计数器一旦过期就会从 0 重新开始，版本号回退会让
   * "小于当前版本"的比较失效（旧令牌反而显得比当前版本新）。每个被踢过的用户
   * 才有一条，占用可以忽略。
   */
  tokenVersion: (userId: number) => `auth:ver:${userId}`,
}

/**
 * RT 轮换宽限窗口（秒）
 *
 * 窗口内，上一轮 RT 仍可被接受，但**不会再次触发轮换** ——
 * 并发刷新落败的一方直接复用当前有效的 RT，使所有标签页最终收敛到同一个 RT。
 *
 * 取值权衡：窗口越长，并发体验越好，但被窃取的旧 RT 也能被多利用一段时间。
 * 30 秒足以覆盖前端 single-flight 之外的真实并发（多标签同时收到 401），
 * 又不至于让复用检测形同虚设。
 */
export const RT_ROTATION_GRACE_SECONDS = 30
