// BadRequestException 请求错误异常，用于返回 400 状态码
import {
  BadRequestException,
  // ConflictException 冲突异常，用于返回 409 状态码（如用户名已存在）
  ConflictException,
  // ForbiddenException 禁止访问异常，用于返回 403 状态码
  ForbiddenException,
  // Injectable 可注入装饰器，标记此类为可被依赖注入的服务
  Injectable,
  // NotFoundException 未找到异常，用于返回 404 状态码
  NotFoundException,
} from '@nestjs/common';
// InjectRepository 装饰器，用于注入 TypeORM Repository
import { InjectRepository } from '@nestjs/typeorm';
// Repository 仓储接口，TypeORM 提供的数据库操作对象
import { Repository } from 'typeorm';
// QueryFailedError 查询失败异常，用于捕获数据库约束冲突等错误
import { QueryFailedError } from 'typeorm';
// JwtService JWT 服务，用于签发和验证 Token；JwtSignOptions JWT 签名选项类型
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
// bcrypt 加密库，用于密码哈希和比对
import * as bcrypt from 'bcrypt';
// 用户实体类，映射数据库 sys_user 表
import { User } from './entities/user.entity';
// 注册用户 DTO，定义注册请求的数据结构
import { CreateUserDto } from './dto/create-user.dto';
// 登录用户 DTO，定义登录请求的数据结构
import { LoginUserDto } from './dto/login-user.dto';
// ConfigService 配置服务，用于读取 .env 等配置文件
import { ConfigService } from '@nestjs/config';
// RedisService Redis 服务，用于 Token 存储和黑名单管理
import { RedisService } from '../redis/redis.service';

// Injectable 装饰器标记此类为可被依赖注入的服务
@Injectable()
export class UserService {
  // 构造函数注入依赖的服务和 Repository
  constructor(
    // InjectRepository 装饰器注入 User 实体的 Repository，用于数据库 CRUD 操作
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    // 注入 JWT 服务，用于 Token 的签发和验证
    private readonly jwtService: JwtService,
    // 注入配置服务，用于读取环境变量配置
    private readonly configService: ConfigService,
    // 注入 Redis 服务，用于 Token 存储和缓存操作
    private readonly redisService: RedisService,
  ) {}

  // 从配置中获取 JWT 过期时间，解决 string 到 StringValue 的类型兼容问题
  // 返回值类型为 JwtSignOptions['expiresIn']，支持 "7d"、"1h"、"30m" 等格式
  private getJwtExpiresIn(key: string): JwtSignOptions['expiresIn'] {
    // 使用 configService 获取指定 key 的配置值，找不到则抛出异常
    return this.configService.getOrThrow<string>(key) as JwtSignOptions['expiresIn'];
  }

  // 将 JWT expiresIn 格式（如 "7d"、"1h"、"30m"）转换为 Redis TTL 秒数
  // 用于设置 Redis 中 Token 的过期时间与 JWT Token 保持一致
  private parseJwtExpiry(key: string): number {
    // 从配置中获取过期时间字符串，如 "7d"
    const value = this.configService.getOrThrow<string>(key);
    // 将字符串中的数字部分解析为整数
    const num = parseInt(value, 10);
    // 如果以 'd' 结尾，表示天数，转换为秒：天数 * 24 * 60 * 60
    if (value.endsWith('d')) return num * 24 * 60 * 60;
    // 如果以 'h' 结尾，表示小时，转换为秒：小时数 * 60 * 60
    if (value.endsWith('h')) return num * 60 * 60;
    // 如果以 'm' 结尾，表示分钟，转换为秒：分钟数 * 60
    if (value.endsWith('m')) return num * 60;
    // 如果以 's' 结尾，表示秒，直接返回数值
    if (value.endsWith('s')) return num;
    // 纯数字默认按秒处理
    return num;
  }

  // 从 Redis 验证 RefreshToken 是否有效，有效则返回用户信息，无效返回 null
  async validateRefreshToken(userId: number, token: string): Promise<User | null> {
    // 从 Redis 中获取存储的 RefreshToken，key 格式为 refresh:token:{userId}
    const stored = await this.redisService.get(`refresh:token:${userId}`);
    // 如果 Redis 中不存在该 key 或存储的 Token 与传入的 Token 不匹配，返回 null
    if (!stored || stored !== token) return null;
    // Token 验证通过，从数据库中查询并返回用户信息
    return this.userRepo.findOneBy({ id: userId });
  }

  // 注册用户：对密码进行 bcrypt 哈希后存入数据库
  // 先查询用户名是否存在可快速返回提示，数据库唯一约束作为兜底防并发
  async create(createUserDto: CreateUserDto) {
    // 先查询用户名是否已存在，存在则快速返回冲突提示，避免无效哈希计算
    const existingUser = await this.userRepo.findOne({
      where: { username: createUserDto.username },
    });
    // 如果用户名已存在，抛出冲突异常，提示用户
    if (existingUser) {
      throw new ConflictException('用户名已注册');
    }

    // 使用 bcrypt 对密码进行哈希加密，saltRounds=10 表示哈希强度
    const hashPwd = await bcrypt.hash(createUserDto.password, 10);
    // 创建用户实体实例，将 DTO 数据展开并用加密后的密码替换原始密码
    const user = this.userRepo.create({
      ...createUserDto, // 展开 DTO 数据（包含 username 等字段）
      password: hashPwd, // 使用 bcrypt 加密后的密码
      createTime: Date.now(), // 设置创建时间为当前毫秒时间戳
    });
    // 将用户实体保存到数据库，若并发请求导致唯一约束冲突，由数据库层面拦截
    try {
      // 执行数据库保存操作，返回保存后的用户实体
      return await this.userRepo.save(user);
    } catch (error) {
      // 捕获数据库唯一约束冲突异常（MySQL errno 1062 表示唯一键冲突）
      if (error instanceof QueryFailedError && (error as any).driverError?.errno === 1062) {
        throw new ConflictException('用户名已注册');
      }
      // 如果不是唯一约束冲突，则抛出原始错误
      throw error;
    }
  }

  // 用户登录：验证用户名和密码，通过后签发 JWT Token
  async login(loginDto: LoginUserDto) {
    // 第一步：根据用户名查询数据库，查找匹配的用户
    const user = await this.userRepo.findOne({
      where: { username: loginDto.username },
    });
    // 如果用户不存在，返回模糊的错误提示，防止攻击者枚举有效用户名
    if (!user) {
      throw new BadRequestException('账号或密码错误');
    }

    // 第二步：使用 bcrypt 比对提交的密码和数据库中存储的哈希密码
    const isPwdOk = await bcrypt.compare(loginDto.password, user.password);
    // 如果密码不匹配，返回模糊的错误提示
    if (!isPwdOk) {
      throw new BadRequestException('账号或密码错误');
    }

    // 第三步：检查用户账号状态，status === 0 表示账号已被禁用
    if (user.status === 0) {
      throw new ForbiddenException('账号已被禁用');
    }

    // 第四步：构建 JWT payload，sub 为用户 ID，username 为用户名
    const payload = { sub: user.id, username: user.username };

    // 1. 签发 AccessToken（短时效），使用独立的 secret 和过期时间配置
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.getJwtExpiresIn('JWT_ACCESS_EXPIRES_IN'),
    });

    // 2. 签发 RefreshToken（长时效），使用独立的 secret 和过期时间配置
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.getJwtExpiresIn('JWT_REFRESH_EXPIRES_IN'),
    });
    // 将 RefreshToken 存入 Redis，设置与 JWT 一致的 TTL（自动过期清理）
    const ttlSeconds = this.parseJwtExpiry('JWT_REFRESH_EXPIRES_IN');
    await this.redisService.set(`refresh:token:${user.id}`, refreshToken, ttlSeconds);
    // 返回 Token 和用户基本信息（不包含密码）
    return {
      accessToken, // 短期有效的访问令牌
      refreshToken, // 长期有效的刷新令牌
      userInfo: { // 用户基本信息
        id: user.id, // 用户 ID
        username: user.username, // 用户名
        status: user.status, // 用户状态
      },
    };
  }

  // 刷新 AccessToken 接口：使用有效的 RefreshToken 签发新的 AccessToken 和 RefreshToken
  async refreshToken(userId: number) {
    // 根据用户 ID 从数据库查询用户信息
    const user = await this.userRepo.findOneBy({ id: userId });
    // 如果用户不存在，抛出未找到异常
    if (!user) throw new NotFoundException('用户不存在');

    // 构建 JWT payload，包含用户 ID 和用户名
    const payload = { sub: user.id, username: user.username };
    // 签发新的 AccessToken（短时效）
    const newAccessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.getJwtExpiresIn('JWT_ACCESS_EXPIRES_IN'),
    });

    // 可选：刷新时轮换 RefreshToken（更安全，防止旧 RefreshToken 被滥用）
    const newRefreshToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.getJwtExpiresIn('JWT_REFRESH_EXPIRES_IN'),
    });
    // 更新 Redis 中的 RefreshToken，设置与 JWT 一致的 TTL，实现 Token 轮换
    const ttlSeconds = this.parseJwtExpiry('JWT_REFRESH_EXPIRES_IN');
    await this.redisService.set(`refresh:token:${userId}`, newRefreshToken, ttlSeconds);
    // 返回新的 AccessToken 和 RefreshToken
    return { accessToken: newAccessToken, refreshToken: newRefreshToken };

  }

  // 退出登录：从 Redis 删除用户的 RefreshToken，使令牌立即失效
  async logout(userId: number) {
    // 从 Redis 中删除用户的 RefreshToken，key 格式为 refresh:token:{userId}
    await this.redisService.del(`refresh:token:${userId}`);
    // 返回退出成功消息
    return { msg: '退出登录成功' };
  }

  // 强制用户下线：将用户加入黑名单（立即生效）+ 删除 RefreshToken
  async forceKick(userId: number) {
    // 根据用户 ID 从数据库查询用户信息
    const user = await this.userRepo.findOneBy({ id: userId });
    // 如果用户不存在，抛出未找到异常
    if (!user) throw new NotFoundException('用户不存在');

    // 1. 将用户加入 Redis 黑名单，TTL 120 秒覆盖 AccessToken 1 分钟的有效期
    await this.redisService.set(`blacklist:token:${userId}`, '1', 120);

    // 2. 删除用户的 RefreshToken，阻止后续通过刷新获取新的 AccessToken
    await this.redisService.del(`refresh:token:${userId}`);

    // 返回强制下线成功消息，包含用户名
    return { msg: `用户 ${user.username} 已强制下线` };
  }

  // 切换用户状态（启用/禁用）：将 status 在 0 和 1 之间切换
  async toggleStatus(userId: number) {
    // 根据用户 ID 从数据库查询用户信息
    const user = await this.userRepo.findOneBy({ id: userId });
    // 如果用户不存在，抛出未找到异常
    if (!user) throw new NotFoundException('用户不存在');

    // 切换状态：当前为 1 则设为 0（禁用），当前为 0 则设为 1（启用）
    user.status = user.status === 1 ? 0 : 1;
    // 保存更新后的用户信息到数据库
    await this.userRepo.save(user);
    // 返回操作结果消息和新的状态值
    return { msg: `用户 ${user.username} 已${user.status === 1 ? '启用' : '禁用'}`, status: user.status };
  }

  // 根据 ID 查询用户信息（不返回密码字段）
  async findById(userId: number) {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('用户不存在');
    return {
      id: user.id,
      username: user.username,
      status: user.status,
      createTime: user.createTime,
    };
  }

  // 查询所有用户列表（不返回密码字段，保证安全）
  async findAll() {
    // 使用 find 查询所有用户，select 指定只返回 id、username、status、createTime 字段
    return await this.userRepo.find({
      select: { id: true, username: true, status: true, createTime: true },
    });
  }
}
