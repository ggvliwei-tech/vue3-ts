// 导入 NestJS 常用装饰器和异常
import { Injectable, BadRequestException } from '@nestjs/common';
// 导入 NestJS 配置服务，用于读取环境变量
import { ConfigService } from '@nestjs/config';
// 导入 Redis 服务，用于验证码和防刷数据存储
import { RedisService } from '../redis/redis.service';

// Injectable 装饰器标记此类为可被依赖注入的服务
@Injectable()
// 短信服务类：封装验证码生成、发送、校验等业务逻辑
export class SmsService {
  // 验证码有效期（5 分钟）
  private readonly CODE_TTL = 300;
  // 单个手机号发送冷却时间（1 分钟）
  private readonly COOLDOWN_TTL = 60;
  // 单个手机号每天最大发送次数
  private readonly MAX_DAILY_COUNT = 10;

  // 构造函数：注入配置服务和 Redis 服务
  constructor(
    private configService: ConfigService,
    private redisService: RedisService,
  ) {}

  // ====================== Redis Key 辅助方法 ======================

  // 生成验证码 Redis Key
  private getCodeKey(phone: string) {
    return `sms:code:${phone}`;
  }

  // 生成发送冷却标记 Redis Key
  private getCooldownKey(phone: string) {
    return `sms:limit:${phone}`;
  }

  // 生成每日发送次数 Redis Key（按日期分桶）
  private getDailyCountKey(phone: string) {
    const date = new Date().toISOString().slice(0, 10); // 格式：YYYY-MM-DD
    return `sms:count:${phone}:${date}`;
  }

  // ====================== 验证码生成 ======================

  // 生成 6 位数字验证码
  private generateCode(): string {
    // 生成 0-999999 的随机数，补齐到 6 位
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // ====================== 防刷校验 ======================

  // 检查发送频率限制
  private async checkRateLimit(phone: string): Promise<void> {
    // 1. 检查冷却时间：1 分钟内是否已发送
    const cooldown = await this.redisService.get(this.getCooldownKey(phone));
    if (cooldown) {
      throw new BadRequestException(`发送过于频繁，请 ${cooldown} 秒后重试`);
    }

    // 2. 检查每日发送次数
    const countStr = await this.redisService.get(this.getDailyCountKey(phone));
    const count = countStr ? parseInt(countStr, 10) : 0;
    if (count >= this.MAX_DAILY_COUNT) {
      throw new BadRequestException('今日发送次数已达上限，请明天再试');
    }
  }

  // 记录发送次数（冷却标记 + 每日计数）
  private async recordSend(phone: string): Promise<void> {
    // 设置冷却标记，1 分钟内不允许重复发送
    await this.redisService.set(this.getCooldownKey(phone), '60', this.COOLDOWN_TTL);
    // 增加每日发送计数（INCR 自动初始化为 0 再加 1）
    const count = await this.redisService.getClient().incr(this.getDailyCountKey(phone));
    // 设置当日计数 key 的过期时间（24 小时后自动清理）
    if (count === 1) {
      await this.redisService.expire(this.getDailyCountKey(phone), 86400);
    }
  }

  // ====================== 发送验证码 ======================

  // 发送短信验证码：含防刷 + Mock/真实发送 + Redis 存储
  async sendCode(phone: string): Promise<{ msg: string; mockCode?: string }> {
    // 1. 防刷校验
    await this.checkRateLimit(phone);

    // 2. 生成验证码
    const code = this.generateCode();

    // 3. 存储验证码到 Redis（5 分钟过期）
    await this.redisService.set(this.getCodeKey(phone), code, this.CODE_TTL);

    // 4. 记录发送行为（防刷计数）
    await this.recordSend(phone);

    // 5. 调用短信服务发送（Mock 模式仅打印日志）
    const useMock = this.configService.get('SMS_MOCK') !== 'false'; // 默认 Mock
    if (useMock) {
      // Mock 模式：直接打印验证码到控制台，方便开发联调
      console.log(`\n========== [SMS Mock] ==========`);
      console.log(`  手机号: ${phone}`);
      console.log(`  验证码: ${code}`);
      console.log(`  有效期: ${this.CODE_TTL} 秒`);
      console.log(`================================\n`);
      return { msg: '验证码已发送（Mock 模式，请查看服务端日志）', mockCode: code };
    }

    // 真实发送模式：调用阿里云短信 SDK
    // 集成方式：npm install @alicloud/dysmsapi20170525 @alicloud/openapi-client
    // 然后取消下面注释启用
    await this.sendViaAliyun(phone, code);

    return { msg: '验证码已发送' };
  }

  // 阿里云短信发送（预留接口）
  private async sendViaAliyun(phone: string, code: string): Promise<void> {
    // TODO: 集成阿里云短信 SDK 后启用以下代码
    // import { Client } from '@alicloud/dysmsapi20170525';
    // import * as OpenApi from '@alicloud/openapi-client';
    // const accessKeyId = this.configService.getOrThrow('ALIYUN_SMS_ACCESS_KEY_ID');
    // const accessKeySecret = this.configService.getOrThrow('ALIYUN_SMS_ACCESS_KEY_SECRET');
    // const signName = this.configService.getOrThrow('ALIYUN_SMS_SIGN_NAME');
    // const templateCode = this.configService.getOrThrow('ALIYUN_SMS_TEMPLATE_CODE');
    // const client = new OpenApi.default(new OpenApi.Config({ accessKeyId, accessKeySecret }));
    // const dysmsClient = new Client(client);
    // await dysmsClient.sendSms({
    //   phone,
    //   signName,
    //   templateCode,
    //   templateParam: JSON.stringify({ code }),
    // });
    throw new BadRequestException('阿里云短信 SDK 未安装，请先 npm install @alicloud/dysmsapi20170525 @alicloud/openapi-client');
  }

  // ====================== 校验验证码 ======================

  // 校验验证码是否正确
  async verifyCode(phone: string, code: string): Promise<boolean> {
    // 从 Redis 获取存储的验证码
    const storedCode = await this.redisService.get(this.getCodeKey(phone));
    // 不存在或已过期
    if (!storedCode) {
      return false;
    }
    // 验证码比对（不区分大小写，验证码本身就是数字）
    if (storedCode !== code) {
      return false;
    }
    // 校验成功，删除验证码（防止重复使用）
    await this.redisService.del(this.getCodeKey(phone));
    return true;
  }
}