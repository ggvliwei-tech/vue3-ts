/**
 * ChatService 单元测试
 *
 * 背景：本次修复把 chat_member 从「授权 + 在线状态二合一」的表，
 * 明确收敛为**持久成员关系**表（谁能看这个房间）。这份测试锁住的就是这套语义：
 *
 *  1. joinRoom 幂等 —— 已存在时返回既有记录而不是抛错
 *  2. joinRoom 用 INSERT IGNORE（orIgnore()）而**不是** upsert ——
 *     MySQL 下 upsert 会生成 ON DUPLICATE KEY UPDATE 把 joinedAt 覆盖掉
 *  3. 离开页面的动作（WS leave-room / disconnect）不再走本 service 的删除方法；
 *     removeMembership 只服务于 REST「退出房间」
 *  4. 读路径的 assertUserInRoom 授权没有被放宽
 *
 * 第 2 条是本次最关键的一条：它是唯一能挡住「以后有人把它改回 repo.upsert()」的自动化手段，
 * 而那个改动不会报错、不会失败，只会静默地把用户的 joinedAt 一路刷新成本次进入的时间。
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { getRepositoryToken } from '@nestjs/typeorm'
import { ChatService } from './chat.service'
import { ChatRoomEntity } from './entities/chat-room.entity'
import { ChatMemberEntity } from './entities/chat-member.entity'
import { ChatMessageEntity } from './entities/chat-message.entity'

// joinRoom 走 createQueryBuilder().insert().into().values().orIgnore().execute() 链式调用
const mockInsertQb = {
  insert: jest.fn().mockReturnThis(),
  into: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  orIgnore: jest.fn().mockReturnThis(),
  orUpdate: jest.fn().mockReturnThis(),
  execute: jest.fn(),
}

const mockMemberRepo = {
  findOneBy: jest.fn(),
  find: jest.fn(),
  findBy: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(() => mockInsertQb),
  // 显式放上 upsert/save：这样「代码改回 upsert」时断言 not.toHaveBeenCalled() 才有意义
  // （如果不声明，调用会直接 TypeError，测出来的失败原因会误导人）
  upsert: jest.fn(),
  save: jest.fn(),
}

// deleteRoom / createRoom 走 roomRepo.manager.transaction，需要能真正执行回调
const mockManager = {
  save: jest.fn(),
  delete: jest.fn(),
}

const mockRoomRepo = {
  findOneBy: jest.fn(),
  findAndCount: jest.fn(),
  findBy: jest.fn(),
  save: jest.fn(),
  manager: {
    transaction: jest.fn((cb: (m: typeof mockManager) => unknown) =>
      cb(mockManager),
    ),
  },
}

const mockMessageRepo = {
  find: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
}

describe('ChatService', () => {
  let service: ChatService

  beforeEach(async () => {
    jest.clearAllMocks()
    // 默认「既不是成员，房间也不存在」，各用例按需用 mockResolvedValueOnce 覆盖。
    // 这里显式设默认值是因为 clearAllMocks 只清调用记录、不清实现，
    // 不设的话上一个用例残留的实现会漏到下一个用例里。
    mockMemberRepo.findOneBy.mockResolvedValue(null)
    mockRoomRepo.findOneBy.mockResolvedValue(null)
    // createQueryBuilder 的返回值在 clearAllMocks 后仍是 mockInsertQb，链式配置保留
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getRepositoryToken(ChatRoomEntity), useValue: mockRoomRepo },
        {
          provide: getRepositoryToken(ChatMemberEntity),
          useValue: mockMemberRepo,
        },
        {
          provide: getRepositoryToken(ChatMessageEntity),
          useValue: mockMessageRepo,
        },
      ],
    }).compile()
    service = module.get(ChatService)
  })

  describe('joinRoom - 幂等加入', () => {
    it('房间不存在时抛 NotFoundException 且不触碰 memberRepo', async () => {
      mockRoomRepo.findOneBy.mockResolvedValueOnce(null)

      await expect(service.joinRoom(999, 1, 'alice')).rejects.toThrow(
        NotFoundException,
      )
      expect(mockMemberRepo.findOneBy).not.toHaveBeenCalled()
      expect(mockInsertQb.execute).not.toHaveBeenCalled()
    })

    it('已是成员时返回既有记录且 created=false，不抛错、不写库', async () => {
      mockRoomRepo.findOneBy.mockResolvedValueOnce({ id: 5, name: 'room5' })
      const existing = {
        id: 77,
        roomId: 5,
        userId: 1,
        username: 'alice',
        joinedAt: 1000,
      }
      mockMemberRepo.findOneBy.mockResolvedValueOnce(existing)

      const result = await service.joinRoom(5, 1, 'alice')

      // 旧实现在这里抛 BadRequestException('您已在该房间中')，是「重连即报错」的来源
      expect(result).toEqual({ member: existing, created: false })
      expect(mockInsertQb.execute).not.toHaveBeenCalled()
    })

    it('新成员时 created=true，values 不含 id，joinedAt 为数字', async () => {
      mockRoomRepo.findOneBy.mockResolvedValueOnce({ id: 5, name: 'room5' })
      mockMemberRepo.findOneBy
        .mockResolvedValueOnce(null) // 先查：没有
        .mockResolvedValueOnce({
          id: 77,
          roomId: 5,
          userId: 1,
          username: 'alice',
          joinedAt: 1,
        })
      mockInsertQb.execute.mockResolvedValueOnce({ raw: { affectedRows: 1 } })

      const result = await service.joinRoom(5, 1, 'alice')

      expect(result.created).toBe(true)
      expect(result.member.id).toBe(77)
      const values = mockInsertQb.values.mock.calls[0][0] as Record<
        string,
        unknown
      >
      expect(values).not.toHaveProperty('id')
      expect(values).toMatchObject({ roomId: 5, userId: 1, username: 'alice' })
      expect(typeof values.joinedAt).toBe('number')
    })

    it('必须走 orIgnore()（INSERT IGNORE），且绝不能调用 orUpdate() / upsert() / save()', async () => {
      mockRoomRepo.findOneBy.mockResolvedValueOnce({ id: 5, name: 'room5' })
      mockMemberRepo.findOneBy
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 77,
          roomId: 5,
          userId: 1,
          username: 'alice',
          joinedAt: 1,
        })
      mockInsertQb.execute.mockResolvedValueOnce({ raw: { affectedRows: 1 } })

      await service.joinRoom(5, 1, 'alice')

      // 语义要求：重复加入不得重置 joinedAt/username。
      // MySQL 下 upsert 生成 ON DUPLICATE KEY UPDATE 会覆盖这两列；
      // TypeORM 的 skipUpdateIfNoValuesChanged 只对 Postgres 家族生效，MySQL 救不了。
      expect(mockInsertQb.orIgnore).toHaveBeenCalled()
      expect(mockInsertQb.orIgnore.mock.invocationCallOrder[0]).toBeLessThan(
        mockInsertQb.execute.mock.invocationCallOrder[0],
      )
      expect(mockInsertQb.orUpdate).not.toHaveBeenCalled()
      expect(mockMemberRepo.upsert).not.toHaveBeenCalled()
      expect(mockMemberRepo.save).not.toHaveBeenCalled()
    })

    it('并发竞态：先查为空但插入时行已存在（affectedRows=0）→ 返回该行且不抛错', async () => {
      mockRoomRepo.findOneBy.mockResolvedValueOnce({ id: 5, name: 'room5' })
      const winner = {
        id: 88,
        roomId: 5,
        userId: 1,
        username: 'alice',
        joinedAt: 999,
      }
      mockMemberRepo.findOneBy
        .mockResolvedValueOnce(null) // 先查：没有（另一个请求刚插入，尚未提交/刚提交）
        .mockResolvedValueOnce(winner) // 回读：拿到了别人插的行
      mockInsertQb.execute.mockResolvedValueOnce({ raw: { affectedRows: 0 } })

      const result = await service.joinRoom(5, 1, 'alice')

      expect(result).toEqual({ member: winner, created: false })
      // 回读到的必须是数据库里的权威行（含真实 joinedAt），不是本次请求编的时间戳
      expect(result.member.joinedAt).toBe(999)
    })
  })

  describe('removeMembership - REST 专用退出房间', () => {
    it('确实删除成员记录（保住 POST /chat/leave 的语义）', async () => {
      await service.removeMembership(5, 1)
      expect(mockMemberRepo.delete).toHaveBeenCalledWith({
        roomId: 5,
        userId: 1,
      })
    })
  })

  describe('getUserRooms - 我的房间', () => {
    it('按 joinedAt DESC 返回，findBy 的乱序不影响结果', async () => {
      // members 已按 joinedAt DESC 取出：最近加入的是房间 3
      mockMemberRepo.find.mockResolvedValueOnce([
        { roomId: 3, userId: 1, joinedAt: 300 },
        { roomId: 1, userId: 1, joinedAt: 100 },
        { roomId: 2, userId: 1, joinedAt: 200 },
      ])
      // IN 查询没有 ORDER BY，数据库返回顺序不可依赖（这里故意打乱）
      mockRoomRepo.findBy.mockResolvedValueOnce([
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ])

      const rooms = await service.getUserRooms(1)

      expect(rooms.map((r) => r.id)).toEqual([3, 1, 2])
    })

    it('无任何成员记录时返回空数组，且不发起房间查询', async () => {
      mockMemberRepo.find.mockResolvedValueOnce([])

      await expect(service.getUserRooms(1)).resolves.toEqual([])
      expect(mockRoomRepo.findBy).not.toHaveBeenCalled()
    })
  })

  describe('授权回归 - 非成员一律 403', () => {
    // 所有读路径都先经 assertUserInRoom → memberRepo.findOneBy({roomId,userId})，
    // 而 beforeEach 里 findOneBy 的默认返回值就是 null（非成员），故此处无需额外设置

    it('getRoomById 非成员 → ForbiddenException', async () => {
      mockRoomRepo.findOneBy.mockResolvedValueOnce({
        id: 5,
        name: 'room5',
        creatorId: 2,
      })
      await expect(service.getRoomById(5, 1)).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('getRoomMembers 非成员 → ForbiddenException（不能遍历 roomId 拿成员名单）', async () => {
      await expect(service.getRoomMembers(5, 1)).rejects.toThrow(
        ForbiddenException,
      )
      expect(mockMemberRepo.find).not.toHaveBeenCalled()
    })

    it('getMessages 非成员 → ForbiddenException（不能遍历 roomId 拖走聊天记录）', async () => {
      await expect(
        service.getMessages({ roomId: 5 } as any, 1),
      ).rejects.toThrow(ForbiddenException)
      expect(mockMessageRepo.findAndCount).not.toHaveBeenCalled()
    })

    it('房间不存在时 getRoomById 抛 NotFoundException（先于权限判断）', async () => {
      mockRoomRepo.findOneBy.mockResolvedValueOnce(null)
      await expect(service.getRoomById(999, 1)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('成员访问 getMessages 正常返回分页结果', async () => {
      mockMemberRepo.findOneBy.mockResolvedValueOnce({
        id: 1,
        roomId: 5,
        userId: 1,
      })
      mockMessageRepo.findAndCount.mockResolvedValueOnce([
        [{ id: 1, content: 'hi' }],
        1,
      ])

      const res = await service.getMessages(
        { roomId: 5, page: 1, limit: 50 } as any,
        1,
      )
      expect(res).toEqual({
        list: [{ id: 1, content: 'hi' }],
        total: 1,
        page: 1,
        limit: 50,
      })
    })
  })

  describe('createRoom / deleteRoom', () => {
    it('createRoom 在事务内建房间 + 写入创建者成员', async () => {
      mockManager.save.mockResolvedValueOnce({
        id: 7,
        name: 'r7',
        creatorId: 1,
      })
      mockManager.save.mockResolvedValueOnce({ id: 1 })

      const room = await service.createRoom({ name: 'r7' } as any, 1, 'alice')

      expect(room.id).toBe(7)
      expect(mockRoomRepo.manager.transaction).toHaveBeenCalled()
      expect(mockManager.save).toHaveBeenCalledTimes(2)
      expect(mockManager.save.mock.calls[0][0]).toBe(ChatRoomEntity)
      expect(mockManager.save.mock.calls[1][0]).toBe(ChatMemberEntity)
      expect(mockManager.save.mock.calls[1][1]).toMatchObject({
        roomId: 7,
        userId: 1,
        username: 'alice',
      })
    })

    it('deleteRoom 在同一事务内按 message → member → room 顺序删除', async () => {
      mockRoomRepo.findOneBy.mockResolvedValueOnce({ id: 5, creatorId: 1 })
      mockManager.delete.mockResolvedValue({})

      await service.deleteRoom(5, 1)

      expect(mockManager.delete.mock.calls.map((c) => c[0])).toEqual([
        ChatMessageEntity,
        ChatMemberEntity,
        ChatRoomEntity,
      ])
      // 三张表删在同一个 transaction 回调里（表间无 FK 级联，中途失败会留孤儿数据）
      expect(mockRoomRepo.manager.transaction).toHaveBeenCalledTimes(1)
    })

    it('非创建者且非管理员删除 → ForbiddenException，且不执行删除', async () => {
      mockRoomRepo.findOneBy.mockResolvedValueOnce({ id: 5, creatorId: 2 })

      await expect(service.deleteRoom(5, 1, false)).rejects.toThrow(
        ForbiddenException,
      )
      expect(mockManager.delete).not.toHaveBeenCalled()
    })

    it('管理员可删他人创建的房间', async () => {
      mockRoomRepo.findOneBy.mockResolvedValueOnce({ id: 5, creatorId: 2 })
      mockManager.delete.mockResolvedValue({})

      await expect(service.deleteRoom(5, 1, true)).resolves.toBe(true)
      expect(mockManager.delete).toHaveBeenCalledTimes(3)
    })
  })
})
