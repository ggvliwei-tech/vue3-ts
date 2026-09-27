/**
 * ChatGateway 单元测试
 *
 * 这份测试的中心是**两个容易被改回去的不变量**：
 *
 *  1. WebSocket 的 leave-room / disconnect **不写数据库**。
 *     它们是「离开页面」（在线状态的生灭），不是「退出房间」（终止成员关系）。
 *     旧实现在这两处调用 chatService.leaveRoom() 物理删除成员行，
 *     导致用户每次离开页面都丢掉成员资格，下次进入房间必然 403「您不在该房间中」。
 *
 *  2. 断线时**不能**读 client.rooms。socket.io 触发 'disconnect' 之前会先执行
 *     _cleanup() → adapter.delAll(id)，而 client.rooms 是个 getter（读 adapter.socketRooms(id)），
 *     此时恒为空 Set。旧代码的 for 循环因此一次都没跑过，整段清理逻辑是死代码。
 *     所以房间列表必须来自自维护的 client.data.rooms —— 第 2 个用例专门钉住这一点。
 *
 * 测试用 fake socket / fake server，不引入 socket.io-client 真连（那样是集成测试，
 * 慢且会掩盖时序问题）。
 */

import { Test, TestingModule } from '@nestjs/testing'
import { Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { ChatGateway } from './chat.gateway'
import { ChatService } from './chat.service'
import { RedisService } from '../redis/redis.service'
import { UserService } from '../user/user.service'
import { RbacService } from '../rbac/rbac.service'

const mockChatService = {
  joinRoom: jest.fn(),
  removeMembership: jest.fn(),
  getRoomMembers: jest.fn(),
  getRecentMessages: jest.fn(),
  isUserInRoom: jest.fn(),
  saveMessage: jest.fn(),
}

/**
 * 造一个 fake Socket.IO server
 *
 * - server.in(room).fetchSockets() → 房间内的 socket 快照（由用例注入）
 * - server.to(room).emit(...)     → 房间广播，记录到 roomEmit
 */
function createFakeServer() {
  const roomEmit = jest.fn()
  const fetchSockets = jest.fn(async () => [] as any[])
  const server = {
    in: jest.fn(() => ({ fetchSockets })),
    to: jest.fn(() => ({ emit: roomEmit })),
  }
  return { server, roomEmit, fetchSockets }
}

/**
 * 造一个 fake Socket
 *
 * @param rooms 真实的 socket.io 里 client.rooms 是个 getter，断线时读到的恒为空；
 *        这里用 Set 模拟它的正常语义（加入后包含房间 ID），
 *        需要模拟「断线时刻」的用例直接把 rooms 留空即可 —— 这正是要覆盖的场景。
 */
function createFakeSocket(overrides: Record<string, any> = {}) {
  const broadcastEmit = jest.fn()
  const socket: any = {
    id: 'sock-1',
    data: { user: { sub: 1, username: 'alice' }, rooms: [] as string[] },
    rooms: new Set<string>(),
    join: jest.fn(async () => undefined),
    leave: jest.fn(),
    emit: jest.fn(),
    broadcast: { to: jest.fn(() => ({ emit: broadcastEmit })) },
    _broadcastEmit: broadcastEmit,
    ...overrides,
  }
  return socket
}

/** 取某个 emit mock 上指定事件名的调用载荷 */
function payloadsOf(emitMock: jest.Mock, event: string) {
  return emitMock.mock.calls.filter((c) => c[0] === event).map((c) => c[1])
}

describe('ChatGateway', () => {
  let gateway: ChatGateway
  let fake: ReturnType<typeof createFakeServer>

  beforeAll(() => {
    // 网关会打不少日志，测试输出里没必要看
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    fake = createFakeServer()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: ChatService, useValue: mockChatService },
        {
          provide: RedisService,
          useValue: { exists: jest.fn(async () => false) },
        },
        { provide: UserService, useValue: { findUserEntity: jest.fn() } },
        {
          provide: RbacService,
          useValue: { getUserPermissions: jest.fn(async () => ['chat:room']) },
        },
      ],
    }).compile()

    gateway = module.get(ChatGateway)
    // @WebSocketServer() 由适配器注入，单测里手工挂上 fake server
    gateway.server = fake.server as any
  })

  describe('handleDisconnect - 断开连接', () => {
    it('不写数据库：不调用 removeMembership，也不删任何成员记录', async () => {
      const client = createFakeSocket()
      client.data.rooms = ['5']

      await gateway.handleDisconnect(client)

      // 断开 = 离开页面，不等于退出房间。ChatService 上任何会改成员关系的方法都不该被调用
      expect(mockChatService.removeMembership).not.toHaveBeenCalled()
      expect(mockChatService.joinRoom).not.toHaveBeenCalled()
    })

    it('client.rooms 为空时，仍按 data.rooms 对房间广播 presence（钉住时序结论）', async () => {
      // 断线时刻的真实状态：_cleanup() 已经把该 socket 从适配器里删了 → client.rooms 恒为空
      const client = createFakeSocket({ rooms: new Set<string>() })
      client.data.rooms = ['5']
      fake.fetchSockets.mockResolvedValueOnce([])

      await gateway.handleDisconnect(client)

      // 若有人把实现改回读 client.rooms，这两条断言会立刻变红
      expect(fake.server.in).toHaveBeenCalledWith('5')
      expect(payloadsOf(fake.roomEmit, 'presence')).toEqual([
        { roomId: 5, onlineUserIds: [] },
      ])
    })

    it('data.rooms 为空时不广播任何东西（从未加入过房间就断线）', async () => {
      const client = createFakeSocket()
      client.data.rooms = []

      await gateway.handleDisconnect(client)

      expect(fake.fetchSockets).not.toHaveBeenCalled()
      expect(fake.roomEmit).not.toHaveBeenCalled()
    })

    it('该用户还有别的 socket 在房间里 → 不广播 member-left（多标签页）', async () => {
      const client = createFakeSocket()
      client.data.rooms = ['5']
      // 同一个用户（sub=1）的另一个标签页仍在房间里
      fake.fetchSockets.mockResolvedValueOnce([
        { id: 'sock-2', data: { user: { sub: 1 } } },
      ])

      await gateway.handleDisconnect(client)

      expect(payloadsOf(fake.roomEmit, 'presence')).toEqual([
        { roomId: 5, onlineUserIds: [1] },
      ])
      expect(payloadsOf(fake.roomEmit, 'member-left')).toHaveLength(0)
    })

    it('该用户已无 socket 在房间里 → 广播 member-left', async () => {
      const client = createFakeSocket()
      client.data.rooms = ['5']
      // 房间里只剩另一个用户
      fake.fetchSockets.mockResolvedValueOnce([
        { id: 'sock-2', data: { user: { sub: 2 } } },
      ])

      await gateway.handleDisconnect(client)

      expect(payloadsOf(fake.roomEmit, 'member-left')).toEqual([
        { userId: 1, username: 'alice', roomId: 5 },
      ])
    })

    it('未认证的 socket（无 user）直接返回，不做任何广播', async () => {
      const client = createFakeSocket({ data: {} })

      await gateway.handleDisconnect(client)

      expect(fake.fetchSockets).not.toHaveBeenCalled()
    })
  })

  describe('leave-room - 离开页面', () => {
    it('退出 Socket.IO 房间 + 清 data.rooms + 不写数据库 + 广播 presence', async () => {
      const client = createFakeSocket()
      client.data.rooms = ['5', '9']
      fake.fetchSockets.mockResolvedValueOnce([
        { id: 'sock-2', data: { user: { sub: 2 } } },
      ])

      await gateway.leaveRoom(client, { roomId: 5 })

      expect(client.leave).toHaveBeenCalledWith('5')
      expect(client.data.rooms).toEqual(['9'])
      // 这一条就是「进入房间必 403」的直接原因所在：以前这里会删掉自己的成员行
      expect(mockChatService.removeMembership).not.toHaveBeenCalled()
      expect(payloadsOf(fake.roomEmit, 'presence')).toEqual([
        { roomId: 5, onlineUserIds: [2] },
      ])
      // 该用户已无 socket 在房间内 → 广播离开
      expect(payloadsOf(fake.roomEmit, 'member-left')).toEqual([
        { userId: 1, username: 'alice', roomId: 5 },
      ])
    })

    it('同一用户还有别的标签页在房间里 → 不广播 member-left', async () => {
      const client = createFakeSocket()
      client.data.rooms = ['5']
      fake.fetchSockets.mockResolvedValueOnce([
        { id: 'sock-2', data: { user: { sub: 1 } } },
      ])

      await gateway.leaveRoom(client, { roomId: 5 })

      expect(payloadsOf(fake.roomEmit, 'member-left')).toHaveLength(0)
    })
  })

  describe('join-room - 加入房间', () => {
    function setupJoin(created: boolean) {
      const client = createFakeSocket()
      mockChatService.joinRoom.mockResolvedValueOnce({
        member: { id: 1, roomId: 5, userId: 1, username: 'alice', joinedAt: 1 },
        created,
      })
      mockChatService.getRoomMembers.mockResolvedValueOnce([
        { id: 1, roomId: 5, userId: 1, username: 'alice', joinedAt: 1 },
      ])
      mockChatService.getRecentMessages.mockResolvedValueOnce([])
      fake.fetchSockets.mockResolvedValueOnce([
        { id: 'sock-1', data: { user: { sub: 1 } } },
      ])
      return client
    }

    it('加入 Socket.IO 房间并维护 data.rooms（不断开时 client.rooms 也同步）', async () => {
      const client = setupJoin(false)

      await gateway.joinRoom(client, { roomId: 5 })

      expect(client.join).toHaveBeenCalledWith('5')
      expect(client.data.rooms).toEqual(['5'])
    })

    it('created=false（重复进入）时不广播 member-joined', async () => {
      const client = setupJoin(false)

      await gateway.joinRoom(client, { roomId: 5 })

      expect(client._broadcastEmit).not.toHaveBeenCalledWith(
        'member-joined',
        expect.anything(),
      )
    })

    it('created=true（首次加入）时才广播 member-joined', async () => {
      const client = setupJoin(true)

      await gateway.joinRoom(client, { roomId: 5 })

      expect(client._broadcastEmit).toHaveBeenCalledWith('member-joined', {
        userId: 1,
        username: 'alice',
        roomId: 5,
      })
    })

    it('presence 的广播早于 room-joined（否则页头在线人数会先从 0 跳变）', async () => {
      const client = setupJoin(false)

      await gateway.joinRoom(client, { roomId: 5 })

      const presenceOrder = fake.roomEmit.mock.invocationCallOrder[0]
      const roomJoinedCall = client.emit.mock.calls.findIndex(
        (c: any[]) => c[0] === 'room-joined',
      )
      expect(roomJoinedCall).toBeGreaterThanOrEqual(0)
      // invocationCallOrder 是跨 mock 共享的全局递增序号，可直接比较先后
      expect(presenceOrder).toBeLessThan(
        client.emit.mock.invocationCallOrder[roomJoinedCall],
      )
    })

    it('room-joined 携带持久成员名册与历史消息', async () => {
      const client = setupJoin(false)

      await gateway.joinRoom(client, { roomId: 5 })

      expect(payloadsOf(client.emit, 'room-joined')).toEqual([
        { roomId: 5, members: expect.any(Array), history: [] },
      ])
    })

    it('加入失败（房间不存在）时回传真实状态码 404 而非一律 400', async () => {
      const client = createFakeSocket()
      const err: any = new Error('房间不存在')
      err.getStatus = () => 404
      mockChatService.joinRoom.mockRejectedValueOnce(err)

      await gateway.joinRoom(client, { roomId: 999 })

      expect(payloadsOf(client.emit, 'error')).toEqual([
        { code: 404, msg: '房间不存在' },
      ])
    })
  })

  describe('broadcastPresence - 在线快照', () => {
    it('按 userId 去重（同一用户多标签页只算一个），并排除 excludeClientId', async () => {
      fake.fetchSockets.mockResolvedValueOnce([
        { id: 'sock-1', data: { user: { sub: 1 } } }, // 同一用户
        { id: 'sock-2', data: { user: { sub: 1 } } }, // 同一用户
        { id: 'sock-3', data: { user: { sub: 2 } } },
        { id: 'sock-4', data: { user: { sub: 3 } } }, // 待排除
        { id: 'sock-5', data: undefined }, // 未认证连接，应被忽略
      ])

      const online = await (gateway as any).broadcastPresence(5, 'sock-4')

      expect(online).toEqual([1, 2])
      expect(fake.server.in).toHaveBeenCalledWith('5')
      expect(payloadsOf(fake.roomEmit, 'presence')).toEqual([
        { roomId: 5, onlineUserIds: [1, 2] },
      ])
    })
  })

  describe('handleMessage - 发送消息（回归）', () => {
    it('Socket.IO 房间不含该房间时拒绝，且不落库', async () => {
      const client = createFakeSocket({ rooms: new Set(['9']) })

      await gateway.handleMessage(client, { roomId: 5, content: 'hi' } as any)

      expect(payloadsOf(client.emit, 'error')).toEqual([
        { code: 403, msg: '您不在该房间中' },
      ])
      expect(mockChatService.saveMessage).not.toHaveBeenCalled()
    })

    it('DB 中已无成员记录时拒绝、踢出 Socket.IO 房间，且不落库', async () => {
      const client = createFakeSocket({ rooms: new Set(['5']) })
      mockChatService.isUserInRoom.mockResolvedValueOnce(false)

      await gateway.handleMessage(client, { roomId: 5, content: 'hi' } as any)

      expect(client.leave).toHaveBeenCalledWith('5')
      expect(payloadsOf(client.emit, 'error')).toEqual([
        { code: 403, msg: '您不在该房间中' },
      ])
      expect(mockChatService.saveMessage).not.toHaveBeenCalled()
    })

    it('成员正常发消息：落库 + 房间广播 + 回报发送者', async () => {
      const client = createFakeSocket({ rooms: new Set(['5']) })
      mockChatService.isUserInRoom.mockResolvedValueOnce(true)
      mockChatService.saveMessage.mockResolvedValueOnce({
        id: 11,
        createdAt: 1700000000000,
      })

      await gateway.handleMessage(client, { roomId: 5, content: 'hi' } as any)

      expect(mockChatService.saveMessage).toHaveBeenCalledWith(
        5,
        1,
        'alice',
        'hi',
      )
      expect(client._broadcastEmit).toHaveBeenCalledWith(
        'new-msg',
        expect.objectContaining({ id: 11 }),
      )
      expect(payloadsOf(client.emit, 'msg-sent')).toEqual([
        expect.objectContaining({ id: 11, senderId: 1, content: 'hi' }),
      ])
    })
  })
})
