/**
 * 认证服务
 *
 * C5 拆分：从原 UserService 抽出的认证与授权职责：
 *  - 登录（login）：风控 → 凭据校验 → 签发 Token → 创建 Session
 *  - 刷新 Token（refreshToken）：Token 轮换
 *  - 退出登录（logout / logoutAll）：撤销 Session
 *  - 强制下线（forceKick）：踢指定设备或全部设备
 *  - 会话列表（getMySessions）
 *
 * 不感知：用户 CRUD —— 由 UserCrudService 承担
 *
 * 审计埋点改为发事件（AuditEvents.LOG），解耦 AuditService
 */
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { EventEmitter2 } from '@nestjs/event-emitter'
import * as bcrypt from 'bcrypt'
import { User } from './entities/user.entity'
import { LoginUserDto } from './dto/login-user.dto'
import { RedisService } from '../redis/redis.service'
import { RbacService } from '../rbac/rbac.service'
import { LoginThrottlerService } from '../auth/login-throttler.service'
import { SessionService, SessionInfo } from '../auth/session.service'
import { AuditEvents } from '../audit/audit.events'
import { parseJwtExpiry, getJwtExpiresIn } from '../../common/utils/jwt.util'

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly rbacService: RbacService,
    private readonly throttlerService: LoginThrottlerService,
    private readonly sessionService: SessionService,
    private readonly events: EventEmitter2,
  ) {}

  /** 兜底：校验 RT 是否匹配 Redis 存储值（兼容调用） */
  async validateRefreshToken(userId: number, token: string): Promise<User | null> {
    const stored = await this.redisService.get(`refresh:token:${userId}`)
    if (!stored || stored !== token) return null
    return this.userRepo.findOneBy({ id: userId })
  }

  /**
   * 登录全流程
   *  1. 风控前置（IP 限流 / 账号锁定）
   *  2. 凭据校验（用户名 + 密码 + 状态）
   *  3. 签发 AccessToken + RefreshToken，写入 Session
   *  4. 发审计事件
   *  5. 加载角色 / 权限码一并返回
   */
  async login(
    loginDto: LoginUserDto,
    meta: { ip: string; userAgent: string },
  ) {
    const ip = meta.ip || 'unknown'
    const userAgent = meta.userAgent || 'unknown'

    // 1. IP 维度限流
    const ipOk = await this.throttlerService.checkIp(ip)
    if (!ipOk) {
      throw new HttpException('登录请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS)
    }
    // 2. 用户维度账号锁定
    const lockRemain = await this.throttlerService.getLockRemaining(loginDto.username)
    if (lockRemain > 0) {
      throw new HttpException(
        `账号已被锁定，请 ${Math.ceil(lockRemain / 60)} 分钟后再试`,
        HttpStatus.LOCKED,
      )
    }

    // 3. 用户名查询
    const user = await this.userRepo.findOne({ where: { username: loginDto.username } })
    if (!user) {
      await this.throttlerService.recordFailure(loginDto.username)
      this.events.emit(AuditEvents.LOG, {
        action: 'login',
        ctx: {
          username: loginDto.username,
          ip,
          userAgent,
          status: 0,
          detail: { reason: '用户不存在' },
        },
      })
      throw new BadRequestException('账号或密码错误')
    }

    // 4. 密码校验
    const isPwdOk = await bcrypt.compare(loginDto.password, user.password)
    if (!isPwdOk) {
      const count = await this.throttlerService.recordFailure(loginDto.username)
      this.events.emit(AuditEvents.LOG, {
        action: 'login',
        ctx: {
          userId: user.id,
          username: user.username,
          ip,
          userAgent,
          status: 0,
          detail: { reason: '密码错误', failCount: count },
        },
      })
      if (count === -1) {
        throw new HttpException('账号已被锁定，请 15 分钟后再试', HttpStatus.LOCKED)
      }
      throw new BadRequestException('账号或密码错误')
    }

    // 5. 账号状态
    if (user.status === 0) {
      this.events.emit(AuditEvents.LOG, {
        action: 'login',
        ctx: {
          userId: user.id,
          username: user.username,
          ip,
          userAgent,
          status: 0,
          detail: { reason: '账号被禁用' },
        },
      })
      throw new ForbiddenException('账号已被禁用')
    }

    // 6. 登录成功 → 清失败计数 + 清强制下线黑名单
    await this.throttlerService.clearFailures(loginDto.username)
    await this.redisService.del(`blacklist:token:${user.id}`)

    // 7. 签发 Token
    const sessionId = this.sessionService.newSessionId()
    const payload = { sub: user.id, username: user.username, sessionId }
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: getJwtExpiresIn(this.configService, 'JWT_ACCESS_EXPIRES_IN'),
    })
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: getJwtExpiresIn(this.configService, 'JWT_REFRESH_EXPIRES_IN'),
    })
    const ttlSeconds = parseJwtExpiry(
      this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
    )
    await this.sessionService.create(user.id, sessionId, refreshToken, meta, ttlSeconds)

    // 8. 审计 + 角色权限
    this.events.emit(AuditEvents.LOG, {
      action: 'login',
      ctx: {
        userId: user.id,
        username: user.username,
        ip,
        userAgent,
        status: 1,
        resource: 'user',
        resourceId: user.id,
        detail: { sessionId },
      },
    })
    const [roles, permissions] = await Promise.all([
      this.rbacService.getUserRoles(user.id),
      this.rbacService.getUserPermissions(user.id),
    ])

    return {
      accessToken,
      refreshToken,
      sessionId,
      userInfo: {
        id: user.id,
        username: user.username,
        status: user.status,
        roles,
        permissions,
      },
    }
  }

  /**
   * 刷新 Token（带轮换）
   *  - sessionId 由 RefreshTokenGuard 解析后传入
   *  - 仅更新当前 session 的 RT，其他设备不受影响
   */
  async refreshToken(userId: number, sessionId: string) {
    const user = await this.userRepo.findOneBy({ id: userId })
    if (!user) throw new NotFoundException('用户不存在')

    const payload = { sub: user.id, username: user.username, sessionId }
    const newAccessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: getJwtExpiresIn(this.configService, 'JWT_ACCESS_EXPIRES_IN'),
    })
    const newRefreshToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: getJwtExpiresIn(this.configService, 'JWT_REFRESH_EXPIRES_IN'),
    })
    const ttlSeconds = parseJwtExpiry(
      this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
    )
    await this.sessionService.updateRefreshToken(userId, sessionId, newRefreshToken, ttlSeconds)

    this.events.emit(AuditEvents.LOG, {
      action: 'refresh',
      ctx: {
        userId,
        username: user.username,
        status: 1,
        resource: 'user',
        resourceId: userId,
        detail: { sessionId },
      },
    })
    return { accessToken: newAccessToken, refreshToken: newRefreshToken }
  }

  /** 退出当前设备 */
  async logout(userId: number, sessionId: string) {
    const user = await this.userRepo.findOneBy({ id: userId })
    await this.sessionService.remove(userId, sessionId)
    this.events.emit(AuditEvents.LOG, {
      action: 'logout',
      ctx: {
        userId,
        username: user?.username,
        status: 1,
        resource: 'user',
        resourceId: userId,
        detail: { sessionId },
      },
    })
    return { msg: '退出登录成功' }
  }

  /** 退出所有设备 */
  async logoutAll(userId: number) {
    const user = await this.userRepo.findOneBy({ id: userId })
    await this.sessionService.removeAll(userId)
    this.events.emit(AuditEvents.LOG, {
      action: 'logout-all',
      ctx: {
        userId,
        username: user?.username,
        status: 1,
        resource: 'user',
        resourceId: userId,
      },
    })
    return { msg: '已退出所有设备' }
  }

  /** 当前用户活跃设备列表 */
  async getMySessions(userId: number): Promise<SessionInfo[]> {
    return this.sessionService.listSessions(userId)
  }

  /**
   * 强制下线（管理端）
   *  - targetSessionId 传入 → 仅踢指定设备
   *  - targetSessionId 不传 → 踢全部设备 + 清角色缓存
   */
  async forceKick(userId: number, targetSessionId?: string) {
    const target = await this.userRepo.findOneBy({ id: userId })
    if (!target) throw new NotFoundException('用户不存在')

    if (targetSessionId) {
      await this.sessionService.remove(userId, targetSessionId)
      this.events.emit(AuditEvents.LOG, {
        action: 'kick',
        ctx: {
          username: target.username,
          status: 1,
          resource: 'user',
          resourceId: userId,
          detail: { targetSessionId, scope: 'session' },
        },
      })
      return { msg: `用户 ${target.username} 的设备 ${targetSessionId} 已下线` }
    }

    await this.sessionService.removeAll(userId)
    await this.rbacService.clearUserCache(userId)
    this.events.emit(AuditEvents.LOG, {
      action: 'kick',
      ctx: {
        username: target.username,
        status: 1,
        resource: 'user',
        resourceId: userId,
        detail: { scope: 'all' },
      },
    })
    return { msg: `用户 ${target.username} 已全设备下线` }
  }
}
