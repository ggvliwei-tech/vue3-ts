import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { RedisModule } from '../redis/redis.module';

// AI 模块定义，封装大语言模型相关功能
@Module({
  imports: [
    ConfigModule,
    RedisModule,
    ThrottlerModule.forRoot([
      {
        ttl: 10000, // 时间窗口，10 秒
        limit: 5,   // 时间窗口内最大请求次数
      },
    ]),
  ],
  providers: [
    AiService, // 注册 AI 服务
    {
      // 注册限流守卫为全局守卫
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
  controllers: [AiController], // 注册 AI 控制器
  exports: [AiService], // 导出 AiService，供其他模块注入使用
})
export class AiModule {}
