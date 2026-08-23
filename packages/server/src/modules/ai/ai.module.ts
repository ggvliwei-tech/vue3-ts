// 导入 NestJS 模块装饰器，用于定义功能模块
import { Module } from '@nestjs/common';
// 导入 NestJS 配置模块，用于读取环境变量和配置
import { ConfigModule } from '@nestjs/config';
// 导入 NestJS 限流模块，用于接口频率限制
import { ThrottlerModule } from '@nestjs/throttler';
// 导入 TypeORM 模块，用于数据库操作
import { TypeOrmModule } from '@nestjs/typeorm';
// 导入 AI 业务逻辑服务类
import { AiService } from './ai.service';
// 导入 AI 控制器类，处理 HTTP 请求
import { AiController } from './ai.controller';
// 导入 Redis 模块，用于会话历史持久化
import { RedisModule } from '../redis/redis.module';
// 导入 AI 会话和消息实体类
import { AiSessionEntity } from './entities/ai-session.entity';
import { AiMessageEntity } from './entities/ai-message.entity';

// 使用 Module 装饰器定义 AI 模块，封装大语言模型相关功能
@Module({
  imports: [ // 声明本模块依赖的其他模块
    ConfigModule, // 配置模块，提供环境变量读取
    RedisModule, // Redis 模块，提供缓存服务
    TypeOrmModule.forFeature([AiSessionEntity, AiMessageEntity]), // 注册 AI 相关实体
    ThrottlerModule.forRoot([ // 配置限流模块，注册全局限流策略
      {
        ttl: 10000, // 限流时间窗口为 10 秒
        limit: 5,   // 时间窗口内最大允许 5 次请求
      },
    ]),
  ],
  providers: [AiService], // 注册 AI 服务提供者，由 NestJS 容器管理实例
  controllers: [AiController], // 注册 AI 控制器，处理路由请求（限流在控制器级别应用）
  exports: [AiService], // 导出 AiService，供其他模块通过依赖注入使用
})
// 导出 AI 模块类，可被 AppModule 或其他模块导入
export class AiModule {}
