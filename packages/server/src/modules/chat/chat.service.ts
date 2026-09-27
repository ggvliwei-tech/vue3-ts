import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChatRoomEntity } from './entities/chat-room.entity';
import { ChatMemberEntity } from './entities/chat-member.entity';
import { ChatMessageEntity } from './entities/chat-message.entity';
import { CreateRoomDto } from './dto/create-room.dto';
import { QueryMessagesDto } from './dto/query-messages.dto';

// 可注入服务装饰器：标记该类为 NestJS 可注入服务
@Injectable()
export class ChatService {
  // 构造函数注入三个 Repository
  constructor(
    @InjectRepository(ChatRoomEntity)
    private readonly roomRepo: Repository<ChatRoomEntity>,
    @InjectRepository(ChatMemberEntity)
    private readonly memberRepo: Repository<ChatMemberEntity>,
    @InjectRepository(ChatMessageEntity)
    private readonly messageRepo: Repository<ChatMessageEntity>,
  ) {}

  // ==================== 房间管理 ====================

  // 创建房间方法：创建新房间并自动将创建者加入为成员
  async createRoom(dto: CreateRoomDto, userId: number, username: string) {
    // 建房间 + 加成员必须原子：两步分开写时若第二步失败，
    // 会留下一个没有任何成员、也永远无人能进的空房间
    return this.roomRepo.manager.transaction(async (manager) => {
      // 保存房间到数据库
      const saved = await manager.save(ChatRoomEntity, {
        name: dto.name,          // 房间名称
        creatorId: userId,       // 创建人 ID
        createdAt: Date.now(),   // 创建时间戳
      });

      // 创建者自动加入房间
      await manager.save(ChatMemberEntity, {
        roomId: saved.id,        // 房间 ID
        userId,                  // 用户 ID
        username,                // 用户名
        joinedAt: Date.now(),    // 加入时间戳
      });
      // 返回创建的房间信息
      return saved;
    });
  }

  // 获取房间列表（分页）
  async getRoomList(page = 1, limit = 20) {
    const skip = (page - 1) * limit;  // 计算跳过的记录数
    // 查询房间列表和总数，按创建时间倒序
    const [list, total] = await this.roomRepo.findAndCount({
      skip,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    // 返回分页结果
    return { list, total, page, limit };
  }

  // 根据 ID 获取房间详情
  async getRoomById(id: number, userId: number) {
    // 查找房间
    const room = await this.roomRepo.findOneBy({ id });
    // 房间不存在则抛出异常
    if (!room) throw new NotFoundException('房间不存在');
    // 非成员不可查看房间详情（水平越权防护）
    await this.assertUserInRoom(userId, id);
    // 返回房间信息
    return room;
  }

  // 删除房间（同时删除该房间所有成员和消息）
  // @param isAdmin 管理员可删除任意房间，普通用户只能删自己创建的
  async deleteRoom(roomId: number, userId: number, isAdmin = false) {
    // 先检查房间是否存在
    const room = await this.roomRepo.findOneBy({ id: roomId });
    if (!room) throw new NotFoundException('房间不存在');

    // 归属校验：creatorId 一直存在库里却没被用过，导致任何持 chat:room-delete
    // 权限码的用户都能删掉任意房间（连同该房间全部历史消息，物理删除不可恢复）
    if (room.creatorId !== userId && !isAdmin) {
      throw new ForbiddenException('只有房间创建者或管理员可以删除该房间');
    }

    // 三张表的删除放在同一事务里：这些表之间没有外键级联
    // （schema 由 nest-db.sql 手工维护，未声明 FK），中途失败会留下孤儿数据
    await this.roomRepo.manager.transaction(async (manager) => {
      // 删除房间所有消息
      await manager.delete(ChatMessageEntity, { roomId });
      // 删除房间所有成员
      await manager.delete(ChatMemberEntity, { roomId });
      // 删除房间本身
      await manager.delete(ChatRoomEntity, { id: roomId });
    });
    return true;
  }

  /**
   * 断言请求者是该房间成员，否则抛 403
   *
   * REST 链路此前只校验权限码（@Permissions('chat:room')），不校验资源归属 ——
   * 权限码是"能否使用聊天功能"，不是"能否访问这个房间"。
   * 没有这层校验，任何持码用户遍历 roomId 即可读取全站房间的成员名单与历史消息。
   * WS 链路一直在用 isUserInRoom 兜底，REST 侧漏了，这里补齐。
   */
  async assertUserInRoom(userId: number, roomId: number): Promise<void> {
    const inRoom = await this.isUserInRoom(userId, roomId);
    if (!inRoom) throw new ForbiddenException('您不在该房间中');
  }

  // ==================== 成员管理 ====================

  /**
   * 幂等加入房间，返回「成员实体」与「本次是否新建了成员关系」
   *
   * 幂等是必需的：chat_member 现在是持久成员关系，重复进入同一房间是常态
   * （每次进入页面都会调用）。旧实现在用户已存在时抛 BadRequestException('您已在该房间中')，
   * 会让断线重连、重复进入直接报错。
   *
   * 返回 created 是为了让调用方知道「是否真的新增了成员」——gateway 据此决定
   * 要不要广播 member-joined，否则重复进入会让房间内所有人的成员列表被反复刷。
   *
   * 注意**不能**改用 this.memberRepo.upsert()：MySQL 下 upsert 生成
   * `ON DUPLICATE KEY UPDATE`，会把 joinedAt/username 覆盖成本次请求的值
   * （TypeORM 的 skipUpdateIfNoValuesChanged 只在 isPostgresFamily 分支生效，MySQL 救不了）。
   * 而「重复加入不重置 joinedAt」正是持久成员关系的语义要求，所以用 orIgnore() ——
   * 生成 INSERT IGNORE，语义是整行忽略。
   *
   * 该写法的正确性依赖 chat_member 上的唯一键 uk_chat_member_room_user
   * （权威定义在 nest-db.sql；实体上的 @Index 只是把不变量写进元数据）。
   * 若某环境的表缺这个键，INSERT IGNORE 不报错也不去重，会静默插出重复行 ——
   * 升级脚本 upgrade-chat-member-persistent.sql 的 Step 0 就是为此设的强制前置检查。
   */
  async joinRoom(roomId: number, userId: number, username: string) {
    // 检查房间是否存在
    const room = await this.roomRepo.findOneBy({ id: roomId });
    if (!room) throw new NotFoundException('房间不存在');

    // 先查：重复进入（绝大多数情况）在这里就返回，不产生任何写操作
    const existing = await this.memberRepo.findOneBy({ roomId, userId });
    if (existing) return { member: existing, created: false };

    // 再插：orIgnore() 兜住「先查后插」之间 TOCTOU 窗口里的并发插入，避免抛 ER_DUP_ENTRY
    const result = await this.memberRepo
      .createQueryBuilder()
      .insert()
      .into(ChatMemberEntity)
      .values({ roomId, userId, username, joinedAt: Date.now() })
      .orIgnore()
      .execute();

    // 命中重复时 INSERT IGNORE 的 affectedRows 为 0（并发下可能是别人先插进去了）
    const created = Number(result.raw?.affectedRows ?? 0) > 0;
    // 无论是否本次插入，都回读一次拿权威行（含真实的 joinedAt，而非本次请求生成的时间戳）
    const member = await this.memberRepo.findOneBy({ roomId, userId });
    // member 为空是理论不可达的防御分支（插入成功后立即回读失败）；
    // 此时只能返回一个没有 id 的占位实体，不阻断调用方流程
    return {
      member:
        member ?? ({ roomId, userId, username, joinedAt: Date.now() } as ChatMemberEntity),
      created,
    };
  }

  /**
   * 【REST 专用】终止成员关系 —— 真正退出这个房间，之后不再能读到该房间的历史消息与成员名单
   *
   * 对应 POST /chat/leave。之所以从 leaveRoom 改名，是因为这个名字此前同时表示两件事，
   * 而本 bug 的根因正是这个歧义：WebSocket 的 leave-room 事件（离开页面/房间）也调用它，
   * 于是把用户的持久成员资格一并删掉了 —— 下次进入房间时 assertUserInRoom 必然 403。
   *
   * 注意：chat.gateway.ts 的 leave-room 事件与 handleDisconnect **都不再调用本方法**。
   * 那两个只表示「离开 Socket.IO 房间」（在线状态的生灭），成员关系必须持久。
   */
  async removeMembership(roomId: number, userId: number) {
    // 删除成员记录
    await this.memberRepo.delete({ roomId, userId });
  }

  // 获取房间成员列表（仅房间成员可见）
  async getRoomMembers(roomId: number, userId: number) {
    // 归属校验：成员名单含用户名等他人信息，不能让任意用户按 roomId 遍历
    await this.assertUserInRoom(userId, roomId);
    // 查询房间所有成员，按加入时间升序
    return this.memberRepo.find({
      where: { roomId },
      order: { joinedAt: 'ASC' },
    });
  }

  // 获取用户所在的所有房间（按加入时间倒序，最近加入的在前）
  async getUserRooms(userId: number) {
    // 查询用户的所有成员记录
    const members = await this.memberRepo.find({
      where: { userId },
      order: { joinedAt: 'DESC' },
    });
    // 无房间则返回空数组（顺带省掉一次无意义的 IN () 查询）
    if (members.length === 0) return [];

    // findBy 的返回顺序由数据库决定（IN 查询没有 ORDER BY），上面 members 的
    // joinedAt DESC 顺序到这里就丢了。用下标当排序权重，查完后重排回来。
    // 同一个房间只会出现一次（唯一键 uk_chat_member_room_user 保证），
    // 但仍用 rank.has 做防御，避免将来约束失效时后一条覆盖前一条。
    const rank = new Map<number, number>();
    members.forEach((m, i) => {
      if (!rank.has(m.roomId)) rank.set(m.roomId, i);
    });

    // 批量查询房间信息（TypeORM 0.3+ 使用 findBy + In 替代 findByIds）
    const rooms = await this.roomRepo.findBy({ id: In([...rank.keys()]) });
    return rooms.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  }

  // 检查用户是否在指定房间中
  async isUserInRoom(userId: number, roomId: number): Promise<boolean> {
    const member = await this.memberRepo.findOneBy({ roomId, userId });
    return !!member;
  }

  // ==================== 消息持久化 ====================

  // 保存消息到数据库
  async saveMessage(roomId: number, senderId: number, senderName: string, content: string) {
    // 创建并保存消息实体
    return this.messageRepo.save({
      roomId,                // 房间 ID
      senderId,              // 发送者 ID
      senderName,            // 发送者用户名
      content,               // 消息内容
      createdAt: Date.now(), // 发送时间戳
    });
  }

  // 获取房间历史消息（分页，仅房间成员可见）
  async getMessages(dto: QueryMessagesDto, userId: number) {
    const { roomId, page = 1, limit = 50 } = dto;  // 解构参数，设默认值
    // 归属校验：没有它，遍历 roomId 即可拖走全站聊天记录
    await this.assertUserInRoom(userId, roomId);
    const skip = (page - 1) * limit;  // 计算跳过的记录数
    // 查询指定房间的消息，按发送时间升序
    const [list, total] = await this.messageRepo.findAndCount({
      where: { roomId },
      skip,
      take: limit,
      order: { createdAt: 'ASC' },
    });
    // 返回分页结果
    return { list, total, page, limit };
  }

  // 获取房间最新 N 条消息
  async getRecentMessages(roomId: number, limit = 50) {
    // 查询最新 limit 条消息，按时间倒序取，返回时反转顺序
    const messages = await this.messageRepo.find({
      where: { roomId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    // 反转数组使其按时间升序显示
    return messages.reverse();
  }
}
