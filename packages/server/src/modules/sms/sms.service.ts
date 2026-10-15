/**
 * 短信服务
 *
 * 安全要点：
 *  - 任何模式下都不通过 API 响应回传验证码：mock 模式只写服务端日志，
 *    避免前端直接拿到验证码绕过短信链路。
 *  - Mock 默认只在 development 生效；staging / production 需要显式
 *    `SMS_MOCK=true` 才开启（见 isMockEnabled），开启时启动日志会告警。
 */
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common'
import type { LoggerService, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston'
import { randomInt } from 'crypto'
import { RedisService } from '../redis/redis.service'

@Injectable()
export class SmsService implements OnModuleInit {
  /** 验证码有效期（5 分钟） */
  private readonly CODE_TTL = 300
  /** 单个手机号发送冷却时间（1 分钟） */
  private readonly COOLDOWN_TTL = 60
  /** 单个手机号每天最大发送次数 */
  private readonly MAX_DAILY_COUNT = 10
  /** 单个验证码允许的最大校验失败次数，超过即作废 */
  private readonly MAX_VERIFY_ATTEMPTS = 5

  constructor(
    private configService: ConfigService,
    private redisService: RedisService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // ====================== Redis Key 辅助方法 ======================

  private getCodeKey(phone: string) {
    return `sms:code:${phone}`
  }

  private getCooldownKey(phone: string) {
    return `sms:limit:${phone}`
  }

  private getDailyCountKey(phone: string) {
    const date = new Date().toISOString().slice(0, 10)
    return `sms:count:${phone}:${date}`
  }

  /** 某手机号当前验证码的连续校验失败次数 */
  private getAttemptKey(phone: string) {
    return `sms:attempt:${phone}`
  }

  // ====================== 验证码生成 ======================

  /**
   * 生成 6 位数字验证码
   * 用 crypto.randomInt 而非 Math.random：后者是可预测的伪随机数，
   * 攻击者拿到若干历史验证码后即可推测后续取值。
   */
  private generateCode(): string {
    return randomInt(100000, 1000000).toString()
  }

  // ====================== 防刷校验 ======================

  private async checkRateLimit(phone: string): Promise<void> {
    const cooldown = await this.redisService.get(this.getCooldownKey(phone))
    if (cooldown) {
      throw new BadRequestException(`发送过于频繁，请 ${cooldown} 秒后重试`)
    }
    const countStr = await this.redisService.get(this.getDailyCountKey(phone))
    const count = countStr ? parseInt(countStr, 10) : 0
    if (count >= this.MAX_DAILY_COUNT) {
      throw new BadRequestException('今日发送次数已达上限，请明天再试')
    }
  }

  private async recordSend(phone: string): Promise<void> {
    await this.redisService.set(this.getCooldownKey(phone), '60', this.COOLDOWN_TTL)
    const count = await this.redisService.getClient().incr(this.getDailyCountKey(phone))
    if (count === 1) {
      await this.redisService.expire(this.getDailyCountKey(phone), 86400)
    }
  }

  // ====================== Mock 模式判断 ======================

  /**
   * 是否走 Mock 短信通道
   *
   *  - development：默认开启，写 `SMS_MOCK=false` 可关闭
   *  - production / staging：默认关闭，**仅** `SMS_MOCK=true`（严格等于字符串 true）才开启
   *
   * 为什么生产也留了开关：阿里云短信 SDK 尚未接入（sendViaAliyun 仍是占位实现），
   * 生产下强制关闭 mock 的后果是「发送验证码」接口必然抛错 —— 忘记密码、短信登录
   * 整条链路不可用。私有部署 / 演示环境可显式打开 mock 先把流程跑通。
   *
   * 打开 mock 不等于放开安全口子：验证码只写服务端日志、**从不回传给前端**，
   * 攻击者拿不到码。真正的代价是用户收不到短信，需要运维从 logs 里取码。
   * 正式上线仍应接入 SDK 并保持本开关关闭（见 onModuleInit 的启动告警）。
   */
  private isMockEnabled(): boolean {
    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development'
    const mockFlag = this.configService.get<string>('SMS_MOCK')
    if (nodeEnv === 'production' || nodeEnv === 'staging') {
      return mockFlag === 'true'
    }
    return mockFlag !== 'false'
  }

  /**
   * 启动期自检：生产/预发若正在用 mock 通道，明确告警。
   * 这类配置错误不写日志的话，只有等用户报「收不到验证码」才会暴露。
   */
  onModuleInit(): void {
    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development'
    if ((nodeEnv === 'production' || nodeEnv === 'staging') && this.isMockEnabled()) {
      this.logger.warn({
        level: 'warn',
        message:
          `[SMS] ${nodeEnv} 环境正在使用 Mock 短信通道（SMS_MOCK=true）：` +
          '验证码不会真实下发，只写在本日志里，终端用户收不到。' +
          '正式上线请接入短信 SDK 并移除 SMS_MOCK。',
        context: 'SmsService',
      })
    }
  }

  // ====================== 发送验证码 ======================

  /**
   * 发送短信验证码
   * 注意：返回值不带 mockCode —— 即使 mock 模式也不通过 API 回传验证码，
   * 开发联调请查看服务端日志。
   */
  async sendCode(phone: string): Promise<{ msg: string }> {
    // 1. 防刷校验
    await this.checkRateLimit(phone)

    // 2. 生成验证码
    const code = this.generateCode()

    // 3. 存储验证码到 Redis（5 分钟过期）
    await this.redisService.set(this.getCodeKey(phone), code, this.CODE_TTL)

    // 4. 记录发送行为（防刷计数）
    await this.recordSend(phone)

    // 5. Mock / 真实发送
    if (this.isMockEnabled()) {
      // Mock 模式：验证码只写结构化日志（不返回给前端），联调时从 logs 里取
      this.logger.log({
        level: 'info',
        message: `[SMS Mock] phone=${phone}, code=${code}, ttl=${this.CODE_TTL}s`,
        context: 'SmsService',
      })
      // 对外文案与真实通道一致：是否走 mock 是服务端内部实现，
      // 回一句「Mock 模式」既泄露实现细节，也会让终端用户困惑。
      return { msg: '验证码已发送' }
    }

    await this.sendViaAliyun(phone, code)
    return { msg: '验证码已发送' }
  }

  /**
   * 阿里云短信发送（预留接口，参数待接入 SDK 后使用，故以 _ 前缀标记）
   *
   * 走到这里说明「生产环境 + 真实通道」，而真实通道尚未接入，属于服务端没准备好，
   * 因此抛 503 而不是 400；文案也必须面向终端用户 —— 早先的版本把
   * 「请先 npm install @alicloud/...」直接抛给前端，用户看不懂，还暴露了实现细节。
   * 运维侧同时打 error 日志，指明两条出路（接 SDK 或临时开 mock）。
   */
  private async sendViaAliyun(_phone: string, _code: string): Promise<void> {
    this.logger.error({
      level: 'error',
      message:
        '[SMS] 短信通道未接入：sendViaAliyun 仍是占位实现，本次验证码未发出。' +
        '请接入 @alicloud/dysmsapi20170525 + @alicloud/openapi-client 补全发送逻辑；' +
        '若只是想让流程先跑通，可临时设置 SMS_MOCK=true（验证码只写日志）。',
      context: 'SmsService',
    })
    throw new ServiceUnavailableException(
      '短信服务暂不可用，请稍后重试或联系管理员',
    )
  }

  // ====================== 校验验证码 ======================

  /**
   * 校验验证码
   *
   * ⚠️ 必须限制失败次数：6 位数字验证码只有 100 万种可能，有效期 5 分钟。
   * 若允许无限次尝试，攻击者可在这 5 分钟内穷举命中，再通过
   * 「忘记密码」接口重置任意账号（含管理员）的密码 —— 完整的账号接管链路。
   * 这里连续失败 MAX_VERIFY_ATTEMPTS 次即作废验证码，必须重新发送。
   */
  async verifyCode(phone: string, code: string): Promise<boolean> {
    const storedCode = await this.redisService.get(this.getCodeKey(phone))
    // 无验证码：未发送 / 已过期 / 已被失败次数作废
    if (!storedCode) return false

    if (storedCode !== code) {
      const attempts = await this.redisService
        .getClient()
        .incr(this.getAttemptKey(phone))
      // 仅首次失败时设置 TTL：每次都续期会让计数永不过期，
      // 把该手机号永久锁死（自伤式 DoS）
      if (attempts === 1) {
        await this.redisService.expire(this.getAttemptKey(phone), this.CODE_TTL)
      }
      if (attempts >= this.MAX_VERIFY_ATTEMPTS) {
        // 作废验证码并清空计数，攻击者必须重新走发送流程
        await this.redisService.del(
          this.getCodeKey(phone),
          this.getAttemptKey(phone),
        )
        this.logger.warn({
          level: 'warn',
          message: `[SMS] 验证码连续校验失败 ${attempts} 次，已作废：phone=${phone}`,
          context: 'SmsService',
        })
      }
      return false
    }

    // 校验成功：立即删除验证码与失败计数（防止重复使用）
    await this.redisService.del(
      this.getCodeKey(phone),
      this.getAttemptKey(phone),
    )
    return true
  }
}
