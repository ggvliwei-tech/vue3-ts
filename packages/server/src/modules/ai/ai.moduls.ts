// 导入 NestJS 模块装饰器
import { Module } from '@nestjs/common';
// 导入配置模块
import { ConfigModule } from '@nestjs/config';
// 导入限流模块和限流守卫
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
// 导入全局守卫 Token
import { APP_GUARD } from '@nestjs/core';
// 导入 AI 服务，处理 AI 业务逻辑
import { AiService } from './ai.service';
// 导入 AI 控制器，处理 AI 相关请求
import { AiController } from './ai.controller';

// AI 模块定义，封装大语言模型相关功能
@Module({
  imports: [
    // 导入配置模块
    ConfigModule,
    // AI 接口限流：10秒最多请求5次，防止刷量扣费
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
