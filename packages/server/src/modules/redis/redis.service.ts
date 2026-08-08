import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;

  constructor(private configService: ConfigService) {
    const redisPassword = this.configService.get('REDIS_PASSWORD');
    this.client = new Redis({
      host: this.configService.get('REDIS_HOST') || 'localhost',
      port: this.configService.get('REDIS_PORT') || 6379,
      password: redisPassword || undefined,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 3) {
          console.warn('[Redis] 连接失败次数过多，停止重试');
          return null;
        }
        return Math.min(times * 500, 2000);
      },
    });

    this.client.on('error', (err) => {
      console.error('[Redis] 连接错误:', err.message);
    });

    this.client.on('ready', () => {
      console.log('[Redis] 连接成功');
    });
  }

  async onModuleInit() {
    // 模块初始化时连接 Redis
    await this.client.connect();
  }

  async onModuleDestroy() {
    // 模块销毁时断开连接
    await this.client.quit();
  }

  // 获取客户端实例，用于特殊操作
  getClient(): Redis {
    return this.client;
  }

  // ====================== 常用 Redis 操作封装 ======================

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<'OK' | null> {
    if (ttl) {
      return this.client.set(key, value, 'EX', ttl);
    }
    return this.client.set(key, value);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  // JSON 序列化/反序列化便捷方法
  async getJson<T>(key: string): Promise<T | null> {
    const data = await this.client.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch (e) {
      console.error(`[Redis] JSON 解析失败, key: ${key}, error: ${(e as Error).message}`);
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttl?: number): Promise<'OK' | null> {
    const data = JSON.stringify(value);
    return this.set(key, data, ttl);
  }
}
