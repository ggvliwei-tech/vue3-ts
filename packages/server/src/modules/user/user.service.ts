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
  // HttpException 通用 HTTP 异常基类
  HttpException,
  // HttpStatus HTTP 状态码枚举
  HttpStatus,
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
// SmsService 短信服务，用于验证码校验
import { SmsService } from '../sms/sms.service';
// RbacService RBAC 服务，用于查询用户角色和权限码
import { RbacService } from '../rbac/rbac.service';
// LoginThrottlerService 登录风控服务，提供 IP 限流 + 失败计数 + 账号锁定
import { LoginThrottlerService } from '../auth/login-throttler.service';
// SessionService 多设备会话管理服务
import { SessionService, SessionInfo } from '../auth/session.service';
// AuditService 审计日志服务
import { AuditService } from '../audit/audit.service';
// 忘记密码 DTO
import { ForgotPasswordDto } from './dto/forgot-password.dto';

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
    // 注入短信服务，用于忘记密码时的验证码校验
    private readonly smsService: SmsService,
    // 注入 RBAC 服务，用于查询用户角色和权限码
    private readonly rbacService: RbacService,
    // 注入登录风控服务，提供 IP 限流 + 失败计数 + 账号锁定
    private readonly throttlerService: LoginThrottlerService,
    // 注入多设备会话管理服务
    private readonly sessionService: SessionService,
    // 注入审计日志服务，记录关键操作
    private readonly auditService: AuditService,
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
  // 注：本方法已被 SessionService.getRefreshToken + RefreshTokenGuard 替代，仅保留兼容调用
  async validateRefreshToken(userId: number, token: string): Promise<User | null> {
    const stored = await this.redisService.get(`refresh:token:${userId}`);
    if (!stored || stored !== token) return null;
    return this.userRepo.findOneBy({ id: userId });
  }

  /**
   * 根据 ID 直接查询用户实体（不做任何加工）
   * 供 Guard 等底层场景使用，避免与 findById 的角色/权限加载耦合
   */
  async findUserEntity(userId: number): Promise<User | null> {
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

    // 检查手机号是否已被注册
    const existingPhone = await this.userRepo.findOne({
      where: { phone: createUserDto.phone },
    });
    if (existingPhone) {
      throw new ConflictException('手机号已注册');
    }

    // 使用 bcrypt 对密码进行哈希加密，saltRounds=10 表示哈希强度
    const hashPwd = await bcrypt.hash(createUserDto.password, 10);
    // 创建用户实体实例，将 DTO 数据展开并用加密后的密码替换原始密码
    const user = this.userRepo.create({
      ...createUserDto, // 展开 DTO 数据（包含 username、phone 等字段）
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
        throw new ConflictException('用户名或手机号已注册');
      }
      // 如果不是唯一约束冲突，则抛出原始错误
      throw error;
    }
  }

  // 用户登录：验证用户名和密码，通过后签发 JWT Token
  // 入参：loginDto 登录凭据，meta 客户端元数据（ip / userAgent）用于 IP 限流 + 会话记录
  async login(loginDto: LoginUserDto, meta: { ip: string; userAgent: string }) {
    const ip = meta.ip || 'unknown'
    const userAgent = meta.userAgent || 'unknown'
    // ========== 第一阶段：风控前置检查 ==========

    // 1. IP 维度限流：同一 IP 10 秒内超过 5 次登录请求则拒绝（防爆破）
    const ipOk = await this.throttlerService.checkIp(ip);
    if (!ipOk) {
      // 返回 429 状态码，提示请求过于频繁
      throw new HttpException('登录请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }

    // 2. 用户维度账号锁定检查：累计失败 5 次会锁定 15 分钟
    const lockRemain = await this.throttlerService.getLockRemaining(loginDto.username);
    if (lockRemain > 0) {
      // 返回 423 状态码（Locked），提示账号已被锁定及剩余时间（分钟）
      throw new HttpException(
        `账号已被锁定，请 ${Math.ceil(lockRemain / 60)} 分钟后再试`,
        HttpStatus.LOCKED,
      );
    }

    // ========== 第二阶段：凭据校验 ==========

    // 根据用户名查询数据库，查找匹配的用户
    const user = await this.userRepo.findOne({
      where: { username: loginDto.username },
    });

    // 用户不存在：使用相同提示 + 记录失败次数（按 username 维度，与 IP 维度独立）
    if (!user) {
      await this.throttlerService.recordFailure(loginDto.username);
      // 审计：登录失败（用户不存在）
      this.auditService.log('login', {
        username: loginDto.username, ip, userAgent, status: 0,
        detail: { reason: '用户不存在' },
      })
      throw new BadRequestException('账号或密码错误');
    }

    // 使用 bcrypt 比对提交的密码和数据库中存储的哈希密码
    const isPwdOk = await bcrypt.compare(loginDto.password, user.password);
    // 如果密码不匹配，记录失败次数（达到阈值会自动锁定）
    if (!isPwdOk) {
      const count = await this.throttlerService.recordFailure(loginDto.username);
      // 审计：登录失败（密码错误）
      this.auditService.log('login', {
        userId: user.id, username: user.username, ip, userAgent, status: 0,
        detail: { reason: '密码错误', failCount: count },
      })
      // count === -1 表示刚触发锁定，附加提示用户
      if (count === -1) {
        throw new HttpException(
          '账号已被锁定，请 15 分钟后再试',
          HttpStatus.LOCKED,
        );
      }
      throw new BadRequestException('账号或密码错误');
    }

    // 检查用户账号状态，status === 0 表示账号已被禁用
    if (user.status === 0) {
      // 审计：登录失败（账号被禁用）
      this.auditService.log('login', {
        userId: user.id, username: user.username, ip, userAgent, status: 0,
        detail: { reason: '账号被禁用' },
      })
      throw new ForbiddenException('账号已被禁用');
    }

    // ========== 第三阶段：登录成功，签发 Token ==========

    // 登录成功，清除该用户的所有失败计数和锁定标记
    await this.throttlerService.clearFailures(loginDto.username);

    // 清除遗留的强制下线黑名单：
    //   - 之前的会话可能因踢人/禁用/密码重置/退出全部设备等原因被加入黑名单（TTL 900s）
    //   - 用户主动重新登录意味着授权意愿明确，应立即清除黑名单
    //   - 否则登录后所有受保护接口都会被 JwtAuthGuard 误判为「已在其他地方下线」
    await this.redisService.del(`blacklist:token:${user.id}`)

    // 生成 sessionId 标识当前设备
    const sessionId = this.sessionService.newSessionId()

    // 构建 JWT payload，sub 为用户 ID，username 为用户名，sessionId 用于多设备会话定位
    const payload = { sub: user.id, username: user.username, sessionId };

    // 1. 签发 AccessToken（短时效），使用独立的 secret 和过期时间配置
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.getJwtExpiresIn('JWT_ACCESS_EXPIRES_IN'),
    });

    // 2. 签发 RefreshToken（长时效），使用独立的 secret 和过期时间配置
    // payload 中加入 sessionId，刷新和下线时可定位到具体设备
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.getJwtExpiresIn('JWT_REFRESH_EXPIRES_IN'),
    });

    // 3. 将 RefreshToken 和会话元数据写入 Redis（多设备支持）
    const ttlSeconds = this.parseJwtExpiry('JWT_REFRESH_EXPIRES_IN');
    await this.sessionService.create(user.id, sessionId, refreshToken, meta, ttlSeconds);

    // 4. 审计：登录成功（异步执行，不阻塞响应）
    this.auditService.log('login', {
      userId: user.id, username: user.username, ip, userAgent,
      status: 1, resource: 'user', resourceId: user.id,
      detail: { sessionId },
    })

    // 4. 加载用户的角色编码和权限码（用于前端展示 + 前端路由 meta 校验）
    // 同时调用两个独立查询，Promise.all 并行加速
    const [roles, permissions] = await Promise.all([
      this.rbacService.getUserRoles(user.id),
      this.rbacService.getUserPermissions(user.id),
    ]);

    // 返回 Token 和用户基本信息（不包含密码）
    return {
      accessToken, // 短期有效的访问令牌
      refreshToken, // 长期有效的刷新令牌
      sessionId, // 当前设备的会话 ID（前端可用于登出指定设备）
      userInfo: { // 用户基本信息
        id: user.id, // 用户 ID
        username: user.username, // 用户名
        status: user.status, // 用户状态
        roles, // 角色编码数组：['admin', 'editor']
        permissions, // 权限码数组：['user:list', 'book:create']
      },
    };
  }

  // 刷新 AccessToken 接口：使用有效的 RefreshToken 签发新的 AccessToken 和 RefreshToken
  // sessionId 由 RefreshTokenGuard 从 JWT payload 中解析并挂载到 req.user
  async refreshToken(userId: number, sessionId: string) {
    // 根据用户 ID 从数据库查询用户信息
    const user = await this.userRepo.findOneBy({ id: userId });
    // 如果用户不存在，抛出未找到异常
    if (!user) throw new NotFoundException('用户不存在');

    // 构建 JWT payload，包含用户 ID + 用户名 + sessionId
    const payload = { sub: user.id, username: user.username, sessionId };
    // 签发新的 AccessToken（短时效）
    const newAccessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.getJwtExpiresIn('JWT_ACCESS_EXPIRES_IN'),
    });

    // 轮换 RefreshToken（更安全，防止旧 RefreshToken 被滥用）
    const newRefreshToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.getJwtExpiresIn('JWT_REFRESH_EXPIRES_IN'),
    });
    // 仅更新当前 sessionId 的 RT，不影响该用户其他设备
    const ttlSeconds = this.parseJwtExpiry('JWT_REFRESH_EXPIRES_IN');
    await this.sessionService.updateRefreshToken(userId, sessionId, newRefreshToken, ttlSeconds);

    // 审计：刷新 token 成功
    this.auditService.log('refresh', {
      userId, username: user.username, status: 1,
      resource: 'user', resourceId: userId,
      detail: { sessionId },
    })

    // 返回新的 AccessToken 和 RefreshToken
    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  // 退出登录：删除当前 session 的 RT + 会话元数据
  // sessionId 由 controller 从 req.user.sessionId 获取
  async logout(userId: number, sessionId: string) {
    const user = await this.userRepo.findOneBy({ id: userId })
    await this.sessionService.remove(userId, sessionId);
    // 审计：退出登录成功
    this.auditService.log('logout', {
      userId, username: user?.username, status: 1,
      resource: 'user', resourceId: userId,
      detail: { sessionId },
    })
    return { msg: '退出登录成功' };
  }

  // 退出所有设备：清空该用户所有 session + 加全局黑名单
  async logoutAll(userId: number) {
    const user = await this.userRepo.findOneBy({ id: userId })
    await this.sessionService.removeAll(userId);
    // 审计：用户主动退出全部设备
    this.auditService.log('logout-all', {
      userId, username: user?.username, status: 1,
      resource: 'user', resourceId: userId,
    })
    return { msg: '已退出所有设备' };
  }

  // 获取当前用户的所有活跃会话（多设备列表）
  async getMySessions(userId: number): Promise<SessionInfo[]> {
    return this.sessionService.listSessions(userId);
  }

  // 强制用户下线：
  //   - targetSessionId 不传：踢全部设备（加黑名单 + 清全部 RT）
  //   - targetSessionId 传入：仅踢指定设备
  // 注：管理员权限校验已上移到 controller 的 @Permissions('user:kick') 装饰器 + PermissionsGuard
  async forceKick(userId: number, targetSessionId?: string) {
    // 根据用户 ID 从数据库查询用户信息
    const target = await this.userRepo.findOneBy({ id: userId });
    // 如果用户不存在，抛出未找到异常
    if (!target) throw new NotFoundException('用户不存在');

    if (targetSessionId) {
      // 仅踢指定设备：删除该 session 的 RT 和元数据
      await this.sessionService.remove(userId, targetSessionId);
      // 审计：踢指定设备下线
      this.auditService.log('kick', {
        username: target.username, status: 1,
        resource: 'user', resourceId: userId,
        detail: { targetSessionId, scope: 'session' },
      })
      return { msg: `用户 ${target.username} 的设备 ${targetSessionId} 已下线` };
    }

    // 踢全部设备：removeAll 内部已设置 900 秒黑名单覆盖剩余 access token 有效期
    await this.sessionService.removeAll(userId);

    // 清除该用户的角色/权限缓存（被踢用户的权限可能在踢前已变更）
    await this.rbacService.clearUserCache(userId);

    // 审计：踢全设备下线
    this.auditService.log('kick', {
      username: target.username, status: 1,
      resource: 'user', resourceId: userId,
      detail: { scope: 'all' },
    })

    // 返回强制下线成功消息
    return { msg: `用户 ${target.username} 已全设备下线` };
  }

  // 切换用户状态（启用/禁用）：将 status 在 0 和 1 之间切换
  // 注：管理员权限校验已上移到 controller 的 @Permissions('user:toggle-status') 装饰器
  async toggleStatus(userId: number) {
    // 根据用户 ID 从数据库查询用户信息
    const target = await this.userRepo.findOneBy({ id: userId });
    // 如果用户不存在，抛出未找到异常
    if (!target) throw new NotFoundException('用户不存在');

    // 切换状态：当前为 1 则设为 0（禁用），当前为 0 则设为 1（启用）
    target.status = target.status === 1 ? 0 : 1;
    // 保存更新后的用户信息到数据库
    await this.userRepo.save(target);
    // 如果是禁用，主动吊销该用户的所有 session，避免已签发的 access token 仍可访问
    if (target.status === 0) {
      await this.sessionService.removeAll(target.id);
    }
    // 审计：状态切换
    this.auditService.log('toggle-status', {
      username: target.username, status: 1,
      resource: 'user', resourceId: userId,
      detail: { newStatus: target.status },
    })
    // 返回操作结果消息和新的状态值
    return { msg: `用户 ${target.username} 已${target.status === 1 ? '启用' : '禁用'}`, status: target.status };
  }

  // 根据 ID 查询用户信息（不返回密码字段）
  async findById(userId: number) {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('用户不存在');
    // 同步加载角色和权限码
    const [roles, permissions] = await Promise.all([
      this.rbacService.getUserRoles(userId),
      this.rbacService.getUserPermissions(userId),
    ]);
    return {
      id: user.id,
      username: user.username,
      status: user.status,
      phone: user.phone,
      createTime: user.createTime,
      roles,           // 角色编码数组
      permissions,     // 权限码数组
    };
  }

  // 查询所有用户列表（不返回密码字段，保证安全）
  async findAll() {
    // 使用 find 查询所有用户，select 指定只返回 id、username、status、createTime 字段
    return await this.userRepo.find({
      select: { id: true, username: true, phone: true, status: true, createTime: true },
    });
  }

  // 通过手机号 + 验证码重置密码
  async resetPasswordByPhone(dto: ForgotPasswordDto) {
    // 1. 校验验证码（不存在或错误时直接抛异常）
    const isValid = await this.smsService.verifyCode(dto.phone, dto.code);
    if (!isValid) {
      // 审计：重置密码失败（验证码错误）
      this.auditService.log('reset-password', {
        username: dto.phone, status: 0,
        detail: { reason: '验证码错误', phone: dto.phone },
      })
      throw new BadRequestException('验证码错误或已过期');
    }

    // 2. 查找用户
    const user = await this.userRepo.findOne({ where: { phone: dto.phone } });
    if (!user) {
      // 审计：重置密码失败（手机号未注册）
      this.auditService.log('reset-password', {
        username: dto.phone, status: 0,
        detail: { reason: '手机号未注册', phone: dto.phone },
      })
      throw new NotFoundException('该手机号未注册');
    }

    // 3. 加密新密码
    user.password = await bcrypt.hash(dto.newPassword, 10);
    // 4. 保存到数据库
    await this.userRepo.save(user);
    // 5. 重置成功后踢下线所有设备（防止攻击者用旧 token 继续访问）
    await this.sessionService.removeAll(user.id);

    // 审计：重置密码成功
    this.auditService.log('reset-password', {
      userId: user.id, username: user.username, status: 1,
      resource: 'user', resourceId: user.id,
      detail: { phone: dto.phone },
    })

    // 返回成功消息
    return { msg: '密码重置成功，请使用新密码登录' };
  }
}
