// 导入 NestJS 模块装饰器
import { Module } from '@nestjs/common';
// 导入 Redis 模块（全局）
import { RedisModule } from '../redis/redis.module';
// 导入短信服务
import { SmsService } from './sms.service';
// 导入短信控制器
import { SmsController } from './sms.controller';

// 使用 Module 装饰器定义短信模块
@Module({
  imports: [RedisModule], // 导入 Redis 模块
  controllers: [SmsController], // 注册控制器
  providers: [SmsService], // 注册服务
  exports: [SmsService], // 导出服务，供 UserModule 使用
})
export class SmsModule {}