/**
 * 用户 CRUD 服务
 *
 * C5 拆分：从原 UserService 抽出的纯 CRUD 职责：
 *  - 用户注册（create）
 *  - 单查 / 列表查询（findById / findAll）
 *  - 状态切换（toggleStatus）
 *  - 密码重置（resetPasswordByPhone）
 *
 * 不感知：JWT、Redis 会话、风控 —— 这些由 AuthService 承担
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, QueryFailedError } from 'typeorm'
import * as bcrypt from 'bcrypt'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { User } from './entities/user.entity'
import { CreateUserDto } from './dto/create-user.dto'
import { ForgotPasswordDto } from './dto/forgot-password.dto'
import { RbacService } from '../rbac/rbac.service'
import { SmsService } from '../sms/sms.service'
import { SessionService } from '../auth/session.service'
import { AuditEvents } from '../audit/audit.events'

@Injectable()
export class UserCrudService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly rbacService: RbacService,
    private readonly smsService: SmsService,
    private readonly sessionService: SessionService,
    private readonly events: EventEmitter2,
  ) {}

  /** 直接查询实体，供 Guard / 底层场景使用 */
  async findUserEntity(userId: number): Promise<User | null> {
    return this.userRepo.findOneBy({ id: userId })
  }

  /** 根据 ID 查询用户详情（含角色 / 权限码） */
  async findById(userId: number) {
    const user = await this.userRepo.findOneBy({ id: userId })
    if (!user) throw new NotFoundException('用户不存在')
    const [roles, permissions] = await Promise.all([
      this.rbacService.getUserRoles(userId),
      this.rbacService.getUserPermissions(userId),
    ])
    return {
      id: user.id,
      username: user.username,
      status: user.status,
      phone: user.phone,
      createTime: user.createTime,
      roles,
      permissions,
    }
  }

  /**
   * 查询用户列表（分页 + 不含密码 / 不含手机号）
   * M7：手机号是 PII，普通列表不应回传，避免后台侧无意泄漏
   *     同时支持分页，避免 SELECT * 在用户量大时拖慢 DB
   */
  async findAll(page = 1, pageSize = 20) {
    const [list, total] = await this.userRepo.findAndCount({
      select: { id: true, username: true, status: true, createTime: true },
      order: { createTime: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    return { list, total, page, pageSize }
  }

  /**
   * 注册用户
   *  - 先查询用户名/手机号是否存在（快速失败）
   *  - bcrypt 哈希后入库
   *  - 数据库唯一约束作为兜底防并发
   */
  async create(createUserDto: CreateUserDto) {
    const existingUser = await this.userRepo.findOne({
      where: { username: createUserDto.username },
    })
    if (existingUser) {
      throw new ConflictException('用户名已注册')
    }
    const existingPhone = await this.userRepo.findOne({
      where: { phone: createUserDto.phone },
    })
    if (existingPhone) {
      throw new ConflictException('手机号已注册')
    }

    const hashPwd = await bcrypt.hash(createUserDto.password, 10)
    const user = this.userRepo.create({
      ...createUserDto,
      password: hashPwd,
      createTime: Date.now(),
    })
    try {
      return await this.userRepo.save(user)
    } catch (error) {
      if (error instanceof QueryFailedError && (error as any).driverError?.errno === 1062) {
        throw new ConflictException('用户名或手机号已注册')
      }
      throw error
    }
  }

  /**
   * 切换用户状态（启用 / 禁用）
   *  - 禁用时主动吊销该用户所有 session
   *  - 发审计事件
   */
  async toggleStatus(userId: number) {
    const target = await this.userRepo.findOneBy({ id: userId })
    if (!target) throw new NotFoundException('用户不存在')

    target.status = target.status === 1 ? 0 : 1
    await this.userRepo.save(target)
    if (target.status === 0) {
      await this.sessionService.removeAll(target.id)
    }
    this.events.emit(AuditEvents.LOG, {
      action: 'toggle-status',
      ctx: {
        username: target.username,
        status: 1,
        resource: 'user',
        resourceId: userId,
        detail: { newStatus: target.status },
      },
    })
    return {
      msg: `用户 ${target.username} 已${target.status === 1 ? '启用' : '禁用'}`,
      status: target.status,
    }
  }

  /**
   * 通过手机号 + 验证码重置密码
   *  - 验证码错误 / 手机号未注册 → 发审计失败事件
   *  - 成功后踢下线所有设备
   */
  async resetPasswordByPhone(dto: ForgotPasswordDto) {
    const isValid = await this.smsService.verifyCode(dto.phone, dto.code)
    if (!isValid) {
      this.events.emit(AuditEvents.LOG, {
        action: 'reset-password',
        ctx: {
          username: dto.phone,
          status: 0,
          detail: { reason: '验证码错误', phone: dto.phone },
        },
      })
      throw new BadRequestException('验证码错误或已过期')
    }

    const user = await this.userRepo.findOne({ where: { phone: dto.phone } })
    if (!user) {
      this.events.emit(AuditEvents.LOG, {
        action: 'reset-password',
        ctx: {
          username: dto.phone,
          status: 0,
          detail: { reason: '手机号未注册', phone: dto.phone },
        },
      })
      throw new NotFoundException('该手机号未注册')
    }

    user.password = await bcrypt.hash(dto.newPassword, 10)
    await this.userRepo.save(user)
    // 重置成功后踢下线所有设备（防止攻击者用旧 token 继续访问）
    await this.sessionService.removeAll(user.id)

    this.events.emit(AuditEvents.LOG, {
      action: 'reset-password',
      ctx: {
        userId: user.id,
        username: user.username,
        status: 1,
        resource: 'user',
        resourceId: user.id,
        detail: { phone: dto.phone },
      },
    })
    return { msg: '密码重置成功，请使用新密码登录' }
  }
}
