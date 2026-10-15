// 从 @nestjs/throttler 继承限流守卫
import { Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'

/**
 * 按**用户**计数、且带独立档位的限流守卫。
 *
 * 背景：ThrottlerGuard 默认按 IP 计数（`getTracker` 返回 req.ip）。
 * 对 AI 这类「按次真实计费」的接口，按 IP 计数有两个反直觉的后果：
 *  - 同办公室 / 运营商 CGNAT 下的用户共享同一份额度，一个人刷满，
 *    其他人全被 429 —— 限流打中的是无辜的人；
 *  - 反过来，单个已登录用户换个 IP 就能拿到一份全新额度，配额形同虚设。
 *
 * 所以本守卫对**已认证**的请求改用用户 ID 作 key：一个账号一份额度。
 * 未认证的请求（req.user 不存在）回落到基类的 IP 计数。
 *
 * ⚠️ 使用前提：必须排在 JwtAuthGuard **之后**，否则 req.user 还没被赋值，
 * 会静默退化成按 IP 计数（不报错，行为却和改造前一样）。
 * 正确写法：`@UseGuards(JwtAuthGuard, PermissionsGuard, UserThrottlerGuard)`
 * —— NestJS 按「全局 → 控制器 → 方法」的顺序执行守卫，同一层级内按声明顺序。
 * 反过来也成立：全局 APP_GUARD 上的 ThrottlerGuard 一定跑在 JwtAuthGuard 之前，
 * 所以**不能**把按用户计数这件事挂在全局守卫上，那样拿不到 req.user。
 *
 * ⚠️ 档位为什么写在这里而不是用 `@Throttle()` 装饰器：
 * `@Throttle()` 写的是**路由元数据**，而元数据是守卫实例无关的 ——
 * 全局 APP_GUARD 上的 ThrottlerGuard 读的是同一份，会被一起改掉。
 * 于是「按用户 20 次/分钟」会变成「按 IP 20 次/分钟」，
 * 恰好制造出本守卫要消除的那个问题。
 * 这里改为只替换本实例的 throttlers，与全局基线互不干扰：
 * 全局仍是 300 次/分钟/IP（兜底），本守卫在其之上再加一道 20 次/分钟/用户。
 *
 * 已知限制：计数存在进程内存里（未接 Redis 存储）。多实例部署时每个实例
 * 各算一份，实际额度会被放大到「实例数 × userLimit」。当前是单实例部署，
 * 无影响；将来横向扩容需要换成 Redis 版 ThrottlerStorage。
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  /** 单个用户在下面这个窗口内允许的请求数 */
  protected readonly userLimit = 20
  /** 计数窗口（毫秒） */
  protected readonly userTtl = 60_000

  async onModuleInit(): Promise<void> {
    await super.onModuleInit()
    // 覆盖掉从 ThrottlerModule 注入的模块基线，换成适用于本守卫的档位
    this.throttlers = [
      { name: 'default', ttl: this.userTtl, limit: this.userLimit },
    ]
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    // JwtAuthGuard 把 payload.sub 复制成了 req.user.id
    const userId = req?.user?.id
    if (userId) {
      return `user:${userId}`
    }
    // 未认证：沿用基类的 IP 判定（含 X-Forwarded-For 的信任链处理）
    return super.getTracker(req)
  }
}
