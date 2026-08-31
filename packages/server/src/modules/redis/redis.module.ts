// 从 @nestjs/common 导入 Global 全局模块装饰器和 Module 模块装饰器
import { Global, Module } from '@nestjs/common'
// 从同级目录导入 RedisService / CacheService
import { RedisService } from './redis.service'
import { CacheService } from './cache.service'

// @Global() 装饰器将此模块声明为全局模块，导入一次后所有模块都可用
@Global()
// @Module() 装饰器定义模块元数据，注册提供者并导出
@Module({
  // 注册 RedisService / CacheService 为模块内的可注入提供者
  providers: [RedisService, CacheService],
  // 将 RedisService / CacheService 导出，供其他模块使用
  exports: [RedisService, CacheService],
})
// 定义 RedisModule 类，作为 NestJS 全局 Redis + 缓存模块
export class RedisModule {}