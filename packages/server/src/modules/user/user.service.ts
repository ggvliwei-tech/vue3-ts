import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm'; // 注入 Repository 的装饰器
import { Repository } from 'typeorm'; // TypeORM 仓储接口，用于数据库操作
import { QueryFailedError } from 'typeorm'; // TypeORM 查询失败异常，用于捕获数据库约束冲突
import { JwtService, JwtSignOptions } from '@nestjs/jwt'; // JWT 服务，用于签发 Token
import * as bcrypt from 'bcrypt'; // bcrypt 加密库，用于密码哈希和比对
import { User } from './entities/user.entity'; // 用户实体类
import { CreateUserDto } from './dto/create-user.dto'; // 注册用户 DTO
import { LoginUserDto } from './dto/login-user.dto';
import { ConfigService } from '@nestjs/config'; // 登录用户 DTO
import { RedisService } from '../redis/redis.service'; // Redis 服务，用于 RefreshToken 存储

// 标记为可注入的服务
@Injectable()
export class UserService {
  // 构造函数注入依赖
  constructor(
    // 注入 User 实体的 Repository，用于数据库操作
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    // 注入 JWT 服务，用于 Token 签发
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  // 从配置中获取 JWT 过期时间，解决 string 到 StringValue 的类型兼容问题
  private getJwtExpiresIn(key: string): JwtSignOptions['expiresIn'] {
    return this.configService.getOrThrow<string>(key) as JwtSignOptions['expiresIn'];
  }

  // 将 JWT expiresIn 格式（如 "7d"、"1h"、"30m"）转为 Redis TTL 秒数
  private parseJwtExpiry(key: string): number {
    const value = this.configService.getOrThrow<string>(key);
    const num = parseInt(value, 10);
    if (value.endsWith('d')) return num * 24 * 60 * 60;
    if (value.endsWith('h')) return num * 60 * 60;
    if (value.endsWith('m')) return num * 60;
    if (value.endsWith('s')) return num;
    return num; // 纯数字默认为秒
  }

  // 从 Redis 验证 RefreshToken 是否有效，有效则返回用户信息
  async validateRefreshToken(userId: number, token: string): Promise<User | null> {
    const stored = await this.redisService.get(`refresh:token:${userId}`);
    if (!stored || stored !== token) return null;
    return this.userRepo.findOneBy({ id: userId });
  }

  // 注册用户：对密码进行 bcrypt 哈希后存入数据库
  // 先查询已存在用户名可快速返回提示，数据库唯一约束兜底防并发
  async create(createUserDto: CreateUserDto) {
    // 先查询用户名是否已存在，存在则快速返回冲突提示
    const existingUser = await this.userRepo.findOne({
      where: { username: createUserDto.username },
    });
    if (existingUser) {
      throw new ConflictException('用户名已注册');
    }

    // 使用 bcrypt 对密码进行哈希加密，saltRounds=10
    const hashPwd = await bcrypt.hash(createUserDto.password, 10);
    // 创建用户实体实例，将加密后的密码替换原始密码
    const user = this.userRepo.create({
      ...createUserDto, // 展开 DTO 数据（包含 username 等）
      password: hashPwd, // 使用加密后的密码
    });
    // 将用户实体保存到数据库，若并发请求导致唯一约束冲突，由数据库层面拦截
    try {
      return await this.userRepo.save(user);
    } catch (error) {
      // 捕获数据库唯一约束冲突（MySQL errno 1062 表示唯一键冲突）
      if (error instanceof QueryFailedError && (error as any).driverError?.errno === 1062) {
        throw new ConflictException('用户名已注册');
      }
      throw error;
    }
  }

  // 用户登录：验证用户名和密码，通过后签发 JWT Token
  async login(loginDto: LoginUserDto) {
    // 第一步：根据用户名查询数据库
    const user = await this.userRepo.findOne({
      where: { username: loginDto.username },
    });
    // 如果用户不存在或密码不匹配，统一返回模糊错误，防止枚举用户
    if (!user) {
      throw new BadRequestException('账号或密码错误');
    }

    // 使用 bcrypt 比对提交的密码和数据库中存储的哈希密码
    const isPwdOk = await bcrypt.compare(loginDto.password, user.password);
    if (!isPwdOk) {
      throw new BadRequestException('账号或密码错误');
    }

    // 第三步：检查用户账号状态，0 表示已禁用
    if (user.status === 0) {
      throw new ForbiddenException('账号已被禁用');
    }

    // 第四步：签发 JWT Token
    // payload 中包含用户 ID（sub）和用户名，Token 过期时间在配置中设置
    const payload = { sub: user.id, username: user.username };
    // const token = this.jwtService.sign(payload);


    // 1. 签发 AccessToken（短时效）
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.getJwtExpiresIn('JWT_ACCESS_EXPIRES_IN'),
    });

    // 2. 签发 RefreshToken（长时效）
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.getJwtExpiresIn('JWT_REFRESH_EXPIRES_IN'),
    });
    // 将 RefreshToken 存入 Redis，设置与 JWT 一致的 TTL（自动过期）
    const ttlSeconds = this.parseJwtExpiry('JWT_REFRESH_EXPIRES_IN');
    await this.redisService.set(`refresh:token:${user.id}`, refreshToken, ttlSeconds);
    // 返回 Token 和用户基本信息
    return {
      accessToken,
      refreshToken,
      userInfo: {
        id: user.id,
        username: user.username,
        status: user.status,
      },
    };
  }

  // 刷新AccessToken接口
  async refreshToken(userId: number) {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('用户不存在');

    const payload = { sub: user.id, username: user.username };
    const newAccessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.getJwtExpiresIn('JWT_ACCESS_EXPIRES_IN'),
    });

    // 可选：刷新时轮换RefreshToken（更安全）
    const newRefreshToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn:this.getJwtExpiresIn('JWT_REFRESH_EXPIRES_IN'),
    });
    // 更新 Redis 中的 RefreshToken，设置与 JWT 一致的 TTL
    const ttlSeconds = this.parseJwtExpiry('JWT_REFRESH_EXPIRES_IN');
    await this.redisService.set(`refresh:token:${userId}`, newRefreshToken, ttlSeconds);
    return { accessToken: newAccessToken, refreshToken: newRefreshToken };

    // return { accessToken: newAccessToken };
  }

  // 退出登录：从 Redis 删除 RefreshToken，令牌立即失效
  async logout(userId: number) {
    await this.redisService.del(`refresh:token:${userId}`);
    return { msg: '退出登录成功' };
  }

  // 强制用户下线：加入黑名单（立即生效）+ 删除 RefreshToken
  async forceKick(userId: number) {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('用户不存在');

    // 1. 将当前用户加入 Redis 黑名单（TTL 120 秒，覆盖 Access Token 1 分钟有效期）
    await this.redisService.set(`blacklist:token:${userId}`, '1', 120);

    // 2. 删除 RefreshToken，阻止后续刷新
    await this.redisService.del(`refresh:token:${userId}`);

    return { msg: `用户 ${user.username} 已强制下线` };
  }

  // 切换用户状态（启用/禁用）
  async toggleStatus(userId: number) {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('用户不存在');

    user.status = user.status === 1 ? 0 : 1;
    await this.userRepo.save(user);
    return { msg: `用户 ${user.username} 已${user.status === 1 ? '启用' : '禁用'}`, status: user.status };
  }

  // 查询所有用户列表
  async findAll() {
    return await this.userRepo.find();
  }

  // 根据用户 ID 查询单个用户
  // 此方法被 JwtAuthGuard 调用，用于验证 Token 中的用户是否存在
  async findById(id: number) {
    return await this.userRepo.findOneBy({ id });
  }
}
