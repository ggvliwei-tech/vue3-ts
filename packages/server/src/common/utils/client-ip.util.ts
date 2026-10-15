import type { Request } from 'express'

/**
 * 取客户端 IP（用于限流键、审计日志）
 *
 * 为什么要抽成函数而不是就地 `req.headers['x-forwarded-for'].split(',')[0]`：
 *
 * `X-Forwarded-For` 是**请求头**，客户端可以任意伪造。而本项目的部署形态是
 * nginx 反代（`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`），
 * 该指令的语义是"在客户端传来的值后面**追加**真实来源"，所以：
 *
 *   客户端发来  X-Forwarded-For: 1.2.3.4        （编的）
 *   nginx 转发   X-Forwarded-For: 1.2.3.4, 5.6.7.8   （5.6.7.8 才是真的）
 *
 * 原来的写法取 `.split(',')[0]`，拿到的正是攻击者编造的那个 —— 每次换一个假 IP
 * 就是全新的限流桶，登录爆破的 IP 限流形同虚设。
 *
 * 正确做法是让 Express 自己算：在 main.ts 里 `app.set('trust proxy', 1)` 之后，
 * `req.ip` 会从右往左跳过可信跳数，取到 nginx 追加的那个真实来源，
 * 客户端伪造的前缀会被丢弃。全局的 ThrottlerGuard 也用 req.ip，一处配置两处受益。
 *
 * ⚠️ 前提：服务**只能**经 nginx 访问。若后端端口直接对外暴露，攻击者可以自己
 * 伪造整条 XFF 链，trust proxy 就失去了意义 —— 这也是 docker-compose 把
 * 3000 端口绑到 127.0.0.1 的原因。
 */
export function getClientIp(req: Pick<Request, 'ip' | 'socket'>): string {
  const ip = req.ip || req.socket?.remoteAddress || ''
  return normalizeIp(ip) || 'unknown'
}

/**
 * 规整 IP 文本，保证同一个客户端不会因为写法不同而落进两个限流桶。
 *
 * 双栈监听（`0.0.0.0` + `::`）时 Node 会把 IPv4 对端报成 IPv4-mapped IPv6，
 * 形如 `::ffff:127.0.0.1`；而经 nginx 转发的同一个客户端，XFF 里写的是
 * 不带前缀的 `127.0.0.1`。两者是同一个地址，键却不同。
 */
function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}
