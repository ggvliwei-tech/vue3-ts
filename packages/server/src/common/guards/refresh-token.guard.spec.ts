/**
 * RefreshTokenGuard 单元测试
 *
 * 核心回归用例（P0）：
 * 守卫必须把 JWT payload 里的 sessionId 挂到 req.user 上。
 *
 * 历史缺陷：这里挂的是 User 实体，而 User 实体压根没有 sessionId 字段，
 * 于是 controller 里 `user.sessionId` 恒为 undefined，
 * AuthService.refreshToken(userId, undefined) 把新 RT 写到了
 * `refresh:token:{userId}:undefined` 这个野 key 上，
 * 真正的 `refresh:token:{userId}:{sessionId}` 里仍留着旧 RT。
 * 结果：用户刷新一次之后，下一次刷新就会被本守卫的复用检测判定为
 * "令牌盗用"，删会话 + 拉黑，强制重新登录。
 * 该缺陷无测试覆盖，故在修复后补上。
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { RefreshTokenGuard } from './refresh-token.guard'
import { UserService } from '../../modules/user/user.service'
import { RedisService } from '../../modules/redis/redis.service'

const USER_ID = 7
const SESSION_ID = 'sess-abc'
const VALID_RT = 'rt-valid'
// ConfigService mock 返回 30m，对应 1800 秒黑名单 TTL
const ACCESS_TTL_SECONDS = 1800

interface FakeRequest {
  cookies: Record<string, string>
  user?: Record<string, unknown>
}

function createContext(cookies: Record<string, string>): {
  context: ExecutionContext
  request: FakeRequest
} {
  const request: FakeRequest = { cookies }
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
  return { context, request }
}

describe('RefreshTokenGuard', () => {
  let guard: RefreshTokenGuard

  const mockJwtService = { verify: jest.fn() }
  const mockConfigService = { getOrThrow: jest.fn(), get: jest.fn() }
  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  }
  const mockUserService = { findUserEntity: jest.fn() }

  beforeEach(async () => {
    jest.clearAllMocks()

    mockConfigService.getOrThrow.mockImplementation((key: string) => {
      if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret'
      if (key === 'JWT_ACCESS_EXPIRES_IN') return '30m'
      throw new Error(`测试未 mock 的配置项：${key}`)
    })
    mockJwtService.verify.mockReturnValue({
      sub: USER_ID,
      username: 'alice',
      sessionId: SESSION_ID,
    })
    mockRedisService.get.mockResolvedValue(VALID_RT)
    mockUserService.findUserEntity.mockResolvedValue({
      id: USER_ID,
      username: 'alice',
      status: 1,
      password: '$2b$10$fakehash',
    })

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenGuard,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: UserService, useValue: mockUserService },
      ],
    }).compile()

    guard = module.get(RefreshTokenGuard)
  })

  describe('校验通过', () => {
    it('req.user 必须携带 sessionId（缺它会导致刷新一次后必掉线）', async () => {
      const { context, request } = createContext({ refresh_token: VALID_RT })

      await expect(guard.canActivate(context)).resolves.toBe(true)

      expect(request.user).toMatchObject({
        id: USER_ID,
        sub: USER_ID,
        username: 'alice',
        sessionId: SESSION_ID,
      })
    })

    it('不应把 password 等实体字段带进请求上下文', async () => {
      const { context, request } = createContext({ refresh_token: VALID_RT })

      await guard.canActivate(context)

      expect(request.user).not.toHaveProperty('password')
      expect(request.user).not.toHaveProperty('createTime')
    })
  })

  describe('拒绝路径', () => {
    it('未携带 refresh_token Cookie 时拒绝', async () => {
      const { context } = createContext({})
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      )
    })

    it('RT 无 sessionId（老格式）时要求重新登录', async () => {
      mockJwtService.verify.mockReturnValue({ sub: USER_ID, username: 'alice' })
      const { context } = createContext({ refresh_token: VALID_RT })

      await expect(guard.canActivate(context)).rejects.toThrow(/格式错误/)
    })

    it('Redis 中该会话已不存在时拒绝', async () => {
      mockRedisService.get.mockResolvedValue(null)
      const { context } = createContext({ refresh_token: VALID_RT })

      await expect(guard.canActivate(context)).rejects.toThrow(/已过期/)
    })
  })

  describe('RT 复用检测', () => {
    it('并发刷新命中宽限窗口时放行，不按盗用处理', async () => {
      // Redis 里已是轮换后的新 RT；请求带的是上一轮 RT，
      // 但它仍留在宽限 key 中 —— 这正是多标签同时刷新的正常情形
      mockRedisService.get.mockImplementation((key: string) => {
        if (key === `refresh:token:${USER_ID}:${SESSION_ID}`)
          return Promise.resolve('rt-rotated')
        if (key === `refresh:prev:${USER_ID}:${SESSION_ID}`)
          return Promise.resolve('rt-stale')
        return Promise.resolve(null)
      })
      const { context, request } = createContext({ refresh_token: 'rt-stale' })

      await expect(guard.canActivate(context)).resolves.toBe(true)

      // 必须标记 rtGrace，AuthService 才会跳过本次轮换；
      // 否则各标签页各自签出新 RT，会再次互相作废，刷新风暴无法收敛
      expect(request.user).toMatchObject({ rtGrace: true })
      // 合法并发不是攻击：不得删会话、不得写黑名单
      expect(mockRedisService.del).not.toHaveBeenCalled()
      expect(mockRedisService.set).not.toHaveBeenCalled()
    })

    it('宽限窗口过期的旧 RT 仍判定为盗用', async () => {
      mockRedisService.get.mockImplementation((key: string) => {
        if (key === `refresh:token:${USER_ID}:${SESSION_ID}`)
          return Promise.resolve('rt-rotated')
        // 宽限 key 已过 TTL，取不到
        return Promise.resolve(null)
      })
      const { context } = createContext({ refresh_token: 'rt-stale' })

      await expect(guard.canActivate(context)).rejects.toThrow(/令牌盗用/)
    })

    it('RT 不一致时只吊销该设备：写设备级黑名单，不写用户级', async () => {
      // Redis 里已是轮换后的新 RT，请求带的是旧 RT
      mockRedisService.get.mockResolvedValue('rt-rotated')
      const { context } = createContext({ refresh_token: 'rt-stale' })

      await expect(guard.canActivate(context)).rejects.toThrow(/令牌盗用/)

      // 删除的必须是带 sessionId 的 key
      expect(mockRedisService.del).toHaveBeenCalledWith(
        `refresh:token:${USER_ID}:${SESSION_ID}`,
      )
      // 必须是设备级黑名单；用用户级会把该用户其他设备一并踢下线，
      // 与产品承诺的"多设备会话互不影响"直接冲突
      expect(mockRedisService.set).toHaveBeenCalledWith(
        `blacklist:session:${USER_ID}:${SESSION_ID}`,
        '1',
        ACCESS_TTL_SECONDS,
      )
      expect(mockRedisService.set).not.toHaveBeenCalledWith(
        `blacklist:token:${USER_ID}`,
        expect.anything(),
        expect.anything(),
      )
    })
  })

  describe('用户状态异常', () => {
    it('用户已被禁用时吊销该设备 RT 并拒绝', async () => {
      mockUserService.findUserEntity.mockResolvedValue({
        id: USER_ID,
        username: 'alice',
        status: 0,
      })
      const { context } = createContext({ refresh_token: VALID_RT })

      await expect(guard.canActivate(context)).rejects.toThrow(/已被禁用/)
      // 删除的 key 必须带 sessionId，否则删不掉任何东西
      expect(mockRedisService.del).toHaveBeenCalledWith(
        `refresh:token:${USER_ID}:${SESSION_ID}`,
      )
    })

    it('用户不存在时吊销该设备 RT 并拒绝', async () => {
      mockUserService.findUserEntity.mockResolvedValue(null)
      const { context } = createContext({ refresh_token: VALID_RT })

      await expect(guard.canActivate(context)).rejects.toThrow(/用户不存在/)
      expect(mockRedisService.del).toHaveBeenCalledWith(
        `refresh:token:${USER_ID}:${SESSION_ID}`,
      )
    })
  })
})
