// 从 @nestjs/common 导入 Injectable 可注入装饰器、OnModuleInit/OnModuleDestroy 生命周期钩子
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// 从 @nestjs/config 导入配置服务，用于读取环境变量和配置文件
import { ConfigService } from '@nestjs/config';
// 导入 ioredis 库的 Redis 客户端类
import Redis from 'ioredis';

// @Injectable() 装饰器使 RedisService 可被 NestJS 依赖注入容器注入
@Injectable()
// 定义 RedisService 类，实现模块初始化时和销毁时的生命周期钩子
export class RedisService implements OnModuleInit, OnModuleDestroy {
  // 声明私有的 Redis 客户端实例，创建后不可变
  private readonly client: Redis;

  // 构造函数，注入 ConfigService 配置服务
  constructor(private configService: ConfigService) {
    // 从配置服务中读取 REDIS_PASSWORD 环境变量
    const redisPassword = this.configService.get('REDIS_PASSWORD');
    // 创建 Redis 客户端实例，传入配置对象
    this.client = new Redis({
      // 从配置服务读取 REDIS_HOST，默认 localhost
      host: this.configService.get('REDIS_HOST') || 'localhost',
      // 从配置服务读取 REDIS_PORT，默认 6379
      port: this.configService.get('REDIS_PORT') || 6379,
      // 若配置了密码则使用密码，否则不设置密码
      password: redisPassword || undefined,
      // 延迟连接，需要手动调用 connect() 才建立连接
      lazyConnect: true,
      // 定义重连策略函数，参数 times 为重试次数
      retryStrategy: (times) => {
        // 如果重试次数超过 3 次，停止重试
        if (times > 3) {
          // 输出警告日志
          console.warn('[Redis] 连接失败次数过多，停止重试');
          // 返回 null 表示停止重试
          return null;
        }
        // 返回重连延迟时间，每次递增 500ms，最大不超过 2000ms
        return Math.min(times * 500, 2000);
      },
    });

    // 监听 Redis 连接错误事件
    this.client.on('error', (err) => {
      // 输出错误日志，包含错误信息
      console.error('[Redis] 连接错误:', err.message);
    });

    // 监听 Redis 连接成功事件
    this.client.on('ready', () => {
      // 输出连接成功日志
      console.log('[Redis] 连接成功');
    });
  }

  // 模块初始化生命周期钩子，在应用启动时调用
  async onModuleInit() {
    // 模块初始化时连接 Redis
    await this.client.connect();
  }

  // 模块销毁生命周期钩子，在应用关闭时调用
  async onModuleDestroy() {
    // 模块销毁时断开连接
    await this.client.quit();
  }

  // 获取客户端实例，用于执行特殊操作
  getClient(): Redis {
    // 返回内部的 Redis 客户端实例
    return this.client;
  }

  // ====================== 常用 Redis 操作封装 ======================

  // 获取指定 key 的值，返回字符串或 null
  async get(key: string): Promise<string | null> {
    // 调用 Redis GET 命令获取值
    return this.client.get(key);
  }

  // 设置指定 key 的值，可选设置过期时间（秒）
  async set(key: string, value: string, ttl?: number): Promise<'OK' | null> {
    // 如果传入了 ttl 过期时间
    if (ttl) {
      // 使用 EX 参数设置过期时间，单位秒
      return this.client.set(key, value, 'EX', ttl);
    }
    // 不设置过期时间，直接设置值
    return this.client.set(key, value);
  }

  // 删除指定 key
  async del(key: string): Promise<number> {
    // 调用 Redis DEL 命令删除 key，返回删除的数量
    return this.client.del(key);
  }

  // 检查指定 key 是否存在
  async exists(key: string): Promise<number> {
    // 调用 Redis EXISTS 命令，返回 1 存在或 0 不存在
    return this.client.exists(key);
  }

  // 为指定 key 设置过期时间
  async expire(key: string, seconds: number): Promise<number> {
    // 调用 Redis EXPIRE 命令，返回 1 成功或 0 失败
    return this.client.expire(key, seconds);
  }

  // 获取指定 key 的剩余过期时间（秒）
  async ttl(key: string): Promise<number> {
    // 调用 Redis TTL 命令获取剩余时间
    return this.client.ttl(key);
  }

  // JSON 序列化/反序列化便捷方法

  // 从 Redis 获取 key 的值并解析为 JSON 对象
  async getJson<T>(key: string): Promise<T | null> {
    // 先调用 get 获取字符串值
    const data = await this.client.get(key);
    // 如果数据为空，返回 null
    if (!data) return null;
    try {
      // 尝试将字符串解析为 JSON 并类型断言为 T
      return JSON.parse(data) as T;
    } catch (e) {
      // 解析失败时输出错误日志
      console.error(`[Redis] JSON 解析失败, key: ${key}, error: ${(e as Error).message}`);
      // 返回 null
      return null;
    }
  }

  // 将值序列化为 JSON 字符串并存入 Redis
  async setJson(key: string, value: unknown, ttl?: number): Promise<'OK' | null> {
    // 将值序列化为 JSON 字符串
    const data = JSON.stringify(value);
    // 调用 set 方法存储，可选设置过期时间
    return this.set(key, data, ttl);
  }
}
