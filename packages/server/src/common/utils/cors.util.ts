/**
 * CORS 来源白名单判定（HTTP 与 WebSocket 共用）
 *
 * 为什么要抽出来：
 * `main.ts` 的 `app.enableCors()` 与 `chat.gateway.ts` 的 `@WebSocketGateway({ cors })`
 * 是**两条独立的链路**，此前各自维护一份白名单。HTTP 侧读 CORS_ORIGINS，
 * WS 侧却把开发端口 `localhost:5173 / 5175` 硬编码在装饰器里 —— 生产部署后
 * 浏览器 origin 是 `http://<域名>`，WS 侧自然对不上。
 *
 * 这类不一致的排查成本极高：HTTP 接口全部正常，唯独聊天室连不上，而且
 * 故障现象（xhr poll error）与"跨域白名单"毫无关联感。
 * 所以两处必须共用同一份判定逻辑，杜绝再次分叉。
 */

/** 开发环境放行的局域网来源（仅非生产生效） */
const LAN_ORIGIN_REGEX =
  /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/

/**
 * 解析 CORS_ORIGINS 环境变量（逗号分隔）。
 * 与 configuration.ts 第 30 行的解析口径保持一致。
 */
export function parseCorsOrigins(raw?: string | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 判定来源是否放行。
 *
 * @param origin 请求的 Origin 头；为空表示同源请求或非浏览器客户端
 * @param allowed 白名单（由 parseCorsOrigins 得到）
 * @param nodeEnv 当前 NODE_ENV，非 production 时额外放行局域网地址
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowed: string[],
  nodeEnv: string | undefined,
): boolean {
  // 无 Origin 头：同源请求、curl、移动端原生请求等。这类请求不受 CORS 约束
  // （CORS 是浏览器机制），放行是标准做法
  if (!origin) return true
  if (allowed.includes(origin)) return true
  // 局域网放行只在非生产生效：生产环境必须显式配置白名单，
  // 否则任意内网来源都能带着凭证跨域调用
  if (nodeEnv !== 'production' && LAN_ORIGIN_REGEX.test(origin)) return true
  return false
}

/**
 * 供 cors 中间件 / Socket.IO 使用的 origin 校验函数。
 *
 * 与 `isOriginAllowed` 的区别：它在**调用时**才读 process.env。
 * 这样 WS 网关可以把它直接写进 `@WebSocketGateway({ cors: { origin } })` —— 装饰器
 * 在类定义时就求值，拿不到 ConfigService；而函数体内的读取发生在每次握手时，
 * 既不依赖注入容器，也能被单测直接构造环境变量验证。
 */
export function corsOriginValidator(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  const allowed = parseCorsOrigins(process.env.CORS_ORIGINS)
  if (isOriginAllowed(origin, allowed, process.env.NODE_ENV)) {
    callback(null, true)
    return
  }
  callback(new Error(`CORS 拒绝：来源 ${origin} 不在白名单中`), false)
}
