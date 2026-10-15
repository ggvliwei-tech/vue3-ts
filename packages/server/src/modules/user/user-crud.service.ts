/**
 * 用户 CRUD 服务
 *
 * 纯 CRUD 职责：
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
// 手机号脱敏：审计日志里只落掩码形态，不落完整号码
import { maskPhone } from '../../common/utils/mask.util'

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
   * 查询用户列表（分页 + 不含密码 / 不含手机号 + 可选 keyword/status 筛选 + 含角色）
   * 手机号是 PII，普通列表不应回传，避免后台侧无意泄漏
   *     同时支持分页，避免 SELECT * 在用户量大时拖慢 DB
   *
   * 角色字段用单次 batch SQL 拉取后挂到 list 上（避免 N+1）
   */
  async findAll(
    page = 1,
    pageSize = 20,
    filters: { keyword?: string; status?: 0 | 1 } = {},
  ) {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .select(['u.id', 'u.username', 'u.status', 'u.createTime'])
      .orderBy('u.createTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)

    if (filters.keyword) {
      // username 模糊匹配；AND keyword 转义由 TypeORM 占位符处理
      qb.andWhere('u.username LIKE :keyword', { keyword: `%${filters.keyword}%` })
    }
    if (filters.status !== undefined) {
      qb.andWhere('u.status = :status', { status: filters.status })
    }

    const [list, total] = await qb.getManyAndCount()

    // 批量取这页用户对应的角色编码（单 SQL）
    const userIds = list.map((u) => u.id)
    const roleMap = await this.rbacService.getRolesByUserIds(userIds)

    const listWithRoles = list.map((u) => ({
      id: u.id,
      username: u.username,
      status: u.status,
      createTime: u.createTime,
      roles: roleMap.get(u.id) ?? [],
    }))

    return { list: listWithRoles, total, page, pageSize }
  }

  /**
   * 注册用户
   *  - 先查询用户名/手机号是否存在（快速失败）
   *  - bcrypt 哈希后入库
   *  - 数据库唯一约束作为兜底防并发
   *
   * 返回值是**显式白名单**，不是 save() 的实体：本接口对匿名用户开放，
   * 直接回传 User 实体会把 password（bcrypt 哈希，可供离线爆破）和 phone 一并送出去。
   * ClassSerializerInterceptor 救不了它 —— User.password 上没有 @Exclude()。
   * 与 findById 一样走白名单，新增字段时必须显式加进来。
   */
  async create(createUserDto: CreateUserDto) {
    const existingUser = await this.userRepo.findOne({
      where: { username: createUserDto.username },
    })
    if (existingUser) {
      throw new ConflictException('用户名已注册')
    }
    // ⚠️ 已知取舍：这里区分了"用户名已注册"/"手机号已注册"，而注册接口对匿名开放，
    // 于是它同时也是一个「手机号是否注册过」的查询接口（用户枚举）。
    // 之所以保留区分：手机号注册是主流程，用户必须知道"这个号已经注册过，去登录"，
    // 统一改成"注册失败"会把这个明确的指引变成一句无用提示。
    // 现有的缓解手段是接口上的 @Throttle(5/min)（见 user.controller.ts 的 register）——
    // 单 IP 每分钟只能试探 5 个号码，批量枚举的成本远高于收益。
    // 若日后这个残余风险不可接受，正解是把手机号校验前移到"注册需先通过短信验证"，
    // 而不是把错误文案改模糊。
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
      const saved = await this.userRepo.save(user)
      // 白名单出参：绝不回传 password / phone
      return {
        id: saved.id,
        username: saved.username,
        status: saved.status,
        createTime: saved.createTime,
      }
    } catch (error) {
      if (error instanceof QueryFailedError && (error as any).driverError?.errno === 1062) {
        throw new ConflictException('用户名或手机号已注册')
      }
      throw error
    }
  }

  /**
   * 切换用户状态（启用 / 禁用）
   *  - 内置超管 admin 不允许被禁用
   *  - 用一条 SQL 原子取反，避免并发下的丢失更新
   *  - 禁用时主动吊销该用户所有 session
   *  - 发审计事件
   */
  async toggleStatus(userId: number) {
    const target = await this.userRepo.findOneBy({ id: userId })
    if (!target) throw new NotFoundException('用户不存在')

    // 保护内置超管：admin 被禁用后没有任何账号能登录后台，只能直接改库恢复。
    // 只拦「启用 → 禁用」这一个方向 —— 若 admin 因故处于禁用态，
    // 放行「禁用 → 启用」是唯一的自助恢复路径，一并拦掉等于自断退路。
    if (target.username === 'admin' && target.status === 1) {
      throw new BadRequestException('内置超级管理员 admin 不允许禁用')
    }

    // 交给数据库在同一条语句里取反。
    // 原先的「读实体 → 改 status 字段 → save()」是 read-modify-write：
    // 两个管理员同时点同一个用户时，双方各自读到同一个旧值、各自取反成同一个
    // 新值，后写入的覆盖先写入的 —— 两次点击只生效一次，其中一人的意图被静默丢弃。
    // 数据库里做 1 - status 则每次执行都必然翻转，不存在这个窗口。
    await this.userRepo
      .createQueryBuilder()
      .update()
      .set({ status: () => '1 - status' })
      .where('id = :id', { id: userId })
      .execute()

    // 取反后回读一次拿到真正生效的值：响应文案与审计详情都要用它，
    // 而并发场景下它未必等于「target.status 取反」。
    const updated = await this.userRepo.findOneBy({ id: userId })
    const newStatus = updated?.status ?? (target.status === 1 ? 0 : 1)

    if (newStatus === 0) {
      await this.sessionService.removeAll(target.id)
    }
    this.events.emit(AuditEvents.LOG, {
      action: 'toggle-status',
      ctx: {
        username: target.username,
        status: 1,
        resource: 'user',
        resourceId: userId,
        detail: { newStatus },
      },
    })
    return {
      msg: `用户 ${target.username} 已${newStatus === 1 ? '启用' : '禁用'}`,
      status: newStatus,
    }
  }

  /**
   * 通过手机号 + 验证码重置密码
   *  - 验证码错误 / 手机号未注册 → 发审计失败事件
   *  - 成功后踢下线所有设备
   */
  async resetPasswordByPhone(dto: ForgotPasswordDto) {
    // 审计里只落脱敏号码。审计表长期留存且可导出 CSV，
    // 写完整手机号等于把它复制到另一个不受用户密码保护、且多个管理员可见的地方。
    // 见 common/utils/mask.util.ts 的说明。
    const maskedPhone = maskPhone(dto.phone)

    const isValid = await this.smsService.verifyCode(dto.phone, dto.code)
    if (!isValid) {
      this.events.emit(AuditEvents.LOG, {
        action: 'reset-password',
        ctx: {
          username: maskedPhone,
          status: 0,
          detail: { reason: '验证码错误', phone: maskedPhone },
        },
      })
      throw new BadRequestException('验证码错误或已过期')
    }

    const user = await this.userRepo.findOne({ where: { phone: dto.phone } })
    if (!user) {
      this.events.emit(AuditEvents.LOG, {
        action: 'reset-password',
        ctx: {
          username: maskedPhone,
          status: 0,
          detail: { reason: '手机号未注册', phone: maskedPhone },
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
        // userId + resourceId 已经唯一确定了当事人，号码只留脱敏形态即可
        detail: { phone: maskedPhone },
      },
    })
    return { msg: '密码重置成功，请使用新密码登录' }
  }
}
