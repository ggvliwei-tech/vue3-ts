// 从 @nestjs/common 导入 Injectable 可注入装饰器、OnModuleInit/OnModuleDestroy 生命周期钩子
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// 从 @nestjs/config 导入配置服务，用于读取环境变量和配置文件
import { ConfigService } from '@nestjs/config';
// 导入 ioredis 库的 Redis 客户端类
import Redis from 'ioredis';
// nest-winston 日志
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Logger as WinstonLogger } from 'winston';

// @Injectable() 装饰器使 RedisService 可被 NestJS 依赖注入容器注入
@Injectable()
// 定义 RedisService 类，实现模块初始化时和销毁时的生命周期钩子
export class RedisService implements OnModuleInit, OnModuleDestroy {
  // 声明私有的 Redis 客户端实例，创建后不可变
  private readonly client: Redis;
  // 当前连接状态，供健康检查/降级判断使用
  private _ready = false;

  // 构造函数，注入 ConfigService 配置服务
  constructor(
    private configService: ConfigService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: WinstonLogger,
  ) {
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
      // C2 修复：永远不返回 null（避免永久失联），只递增退避上限
      // 旧实现 3 次后返回 null → Redis 闪断 2 秒后客户端永久锁死
      // 新实现：无限重试，backoff 封顶 10 秒，配合 maxRetriesPerRequest 快速失败
      retryStrategy: (times) => Math.min(times * 500, 10_000),
      // 单个命令最大重试次数（避免请求无限挂起）
      maxRetriesPerRequest: 2,
      // 离线时不缓存请求，立即失败（让上层走降级路径）
      enableOfflineQueue: false,
    });

    // 监听 Redis 连接错误事件
    this.client.on('error', (err) => {
      this._ready = false
      this.logger.warn(`[Redis] 连接错误: ${err.message}`)
    });

    // 监听 Redis 连接成功事件
    this.client.on('ready', () => {
      this._ready = true
      this.logger.info('[Redis] 连接成功')
    });

    // 监听 end（连接关闭）
    this.client.on('end', () => {
      this._ready = false
    });
  }

  /**
   * 当前 Redis 连接是否就绪
   * 供 rbac.service / health.controller 等做降级判断
   */
  isReady(): boolean {
    return this._ready
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

  // 自增 key 的值（不存在则从 0 开始），返回自增后的新值
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  // 设置 key 的值，仅当 key 不存在时（SETNX），返回 1 成功 / 0 已存在
  async setnx(key: string, value: string, ttl?: number): Promise<number> {
    // SETNX + EXPIRE 不是原子操作，使用 SET key value NX EX seconds 单命令实现
    const result = ttl
      ? await this.client.set(key, value, 'EX', ttl, 'NX')
      : await this.client.set(key, value, 'NX')
    return result === 'OK' ? 1 : 0
  }

  // ====================== Hash 操作封装（多设备会话） ======================

  // 设置 Hash 字段值（HSET key field value），返回新增字段数量
  async hset(key: string, field: string, value: string): Promise<number> {
    return this.client.hset(key, field, value)
  }

  // 获取 Hash 单个字段值（HGET key field）
  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field)
  }

  // 获取 Hash 所有字段和值（HGETALL key），返回对象
  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key)
  }

  // 删除 Hash 一个或多个字段（HDEL），返回删除字段数量
  async hdel(key: string, ...fields: string[]): Promise<number> {
    if (fields.length === 0) return 0
    return this.client.hdel(key, ...fields)
  }

  // 获取 Hash 所有字段名（HKEYS）
  async hkeys(key: string): Promise<string[]> {
    return this.client.hkeys(key)
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
      // 解析失败时输出错误日志（用 winston，不污染 stdout）
      this.logger.warn(`[Redis] JSON 解析失败, key: ${key}, error: ${(e as Error).message}`);
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
