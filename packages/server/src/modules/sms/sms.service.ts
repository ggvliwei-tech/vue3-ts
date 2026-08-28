/**
 * 短信服务（M12 收紧）
 *
 * 关键修复：
 *  - 不再通过 API 响应回传 mockCode（避免前端直接拿到验证码绕过短信链路）
 *  - Mock 仅在 development 环境生效，staging / production 强制走真实通道
 *  - console.log 替换为 winston 结构化日志
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import type { LoggerService } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston'
import { RedisService } from '../redis/redis.service'

@Injectable()
export class SmsService {
  /** 验证码有效期（5 分钟） */
  private readonly CODE_TTL = 300
  /** 单个手机号发送冷却时间（1 分钟） */
  private readonly COOLDOWN_TTL = 60
  /** 单个手机号每天最大发送次数 */
  private readonly MAX_DAILY_COUNT = 10

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

  // ====================== 验证码生成 ======================

  /** 生成 6 位数字验证码 */
  private generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString()
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
   * M12 收紧：Mock 仅在 development 环境生效
   *  - production / staging 强制走真实通道
   *  - SMS_MOCK=false 可在 dev 环境显式关闭
   */
  private isMockEnabled(): boolean {
    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development'
    if (nodeEnv === 'production' || nodeEnv === 'staging') return false
    return this.configService.get<string>('SMS_MOCK') !== 'false'
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
      // Mock 模式：写到结构化日志（不返回给前端），开发联调从 logs 取
      this.logger.log({
        level: 'info',
        message: `[SMS Mock] phone=${phone}, code=${code}, ttl=${this.CODE_TTL}s`,
        context: 'SmsService',
      })
      return { msg: '验证码已发送（Mock 模式，请查看服务端日志）' }
    }

    await this.sendViaAliyun(phone, code)
    return { msg: '验证码已发送' }
  }

  // 阿里云短信发送（预留接口）
  private async sendViaAliyun(phone: string, code: string): Promise<void> {
    throw new BadRequestException(
      '阿里云短信 SDK 未安装，请先 npm install @alicloud/dysmsapi20170525 @alicloud/openapi-client',
    )
  }

  // ====================== 校验验证码 ======================

  async verifyCode(phone: string, code: string): Promise<boolean> {
    const storedCode = await this.redisService.get(this.getCodeKey(phone))
    if (!storedCode) return false
    if (storedCode !== code) return false
    // 校验成功立即删除验证码（防止重复使用）
    await this.redisService.del(this.getCodeKey(phone))
    return true
  }
}
