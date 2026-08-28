/**
 * User 服务门面
 *
 * C5 拆分：原 11 依赖的上帝服务已拆分为：
 *  - AuthService      登录 / 刷新 / 退出 / 强制下线 / 会话管理
 *  - UserCrudService  注册 / 查询 / 状态切换 / 重置密码
 *
 * UserService 现作为薄门面层（Façade）保留公开方法，
 * 内部直接委托给上面两个服务，确保现有 controller / 其他模块的
 * 依赖注入无需变动即可继续工作。
 *
 * 新代码建议直接注入 AuthService / UserCrudService，避免经过门面。
 */
import { Injectable } from '@nestjs/common'
import { User } from './entities/user.entity'
import { CreateUserDto } from './dto/create-user.dto'
import { LoginUserDto } from './dto/login-user.dto'
import { ForgotPasswordDto } from './dto/forgot-password.dto'
import { SessionInfo } from '../auth/session.service'
import { AuthService } from './auth.service'
import { UserCrudService } from './user-crud.service'

@Injectable()
export class UserService {
  constructor(
    private readonly authService: AuthService,
    private readonly userCrudService: UserCrudService,
  ) {}

  // ============ 认证相关（委托给 AuthService） ============

  login(dto: LoginUserDto, meta: { ip: string; userAgent: string }) {
    return this.authService.login(dto, meta)
  }

  refreshToken(userId: number, sessionId: string) {
    return this.authService.refreshToken(userId, sessionId)
  }

  logout(userId: number, sessionId: string) {
    return this.authService.logout(userId, sessionId)
  }

  logoutAll(userId: number) {
    return this.authService.logoutAll(userId)
  }

  getMySessions(userId: number): Promise<SessionInfo[]> {
    return this.authService.getMySessions(userId)
  }

  forceKick(userId: number, targetSessionId?: string) {
    return this.authService.forceKick(userId, targetSessionId)
  }

  validateRefreshToken(userId: number, token: string) {
    return this.authService.validateRefreshToken(userId, token)
  }

  // ============ CRUD 相关（委托给 UserCrudService） ============

  create(dto: CreateUserDto) {
    return this.userCrudService.create(dto)
  }

  findUserEntity(userId: number) {
    return this.userCrudService.findUserEntity(userId)
  }

  findById(userId: number) {
    return this.userCrudService.findById(userId)
  }

  findAll(
    page = 1,
    pageSize = 20,
    filters: { keyword?: string; status?: 0 | 1 } = {},
  ) {
    return this.userCrudService.findAll(page, pageSize, filters)
  }

  toggleStatus(userId: number) {
    return this.userCrudService.toggleStatus(userId)
  }

  resetPasswordByPhone(dto: ForgotPasswordDto) {
    return this.userCrudService.resetPasswordByPhone(dto)
  }

  // ============ 兼容旧调用方 ============

  /** 兼容：JwtAuthGuard 等旧位置仍可能注入 UserService */
  // 这里只是占位，实际由 AuthService 内部使用
  // User 实体类型保留以便旧 TS 引用通过
  readonly __legacyUserType?: User
}
