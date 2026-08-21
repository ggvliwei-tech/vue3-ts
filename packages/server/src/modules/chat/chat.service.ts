import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
    // 创建房间实体实例
    const room = this.roomRepo.create({
      name: dto.name,          // 房间名称
      creatorId: userId,       // 创建人 ID
      createdAt: Date.now(),   // 创建时间戳
    });
    // 保存房间到数据库
    const saved = await this.roomRepo.save(room);

    // 创建者自动加入房间
    await this.memberRepo.save({
      roomId: saved.id,        // 房间 ID
      userId,                  // 用户 ID
      username,                // 用户名
      joinedAt: Date.now(),    // 加入时间戳
    });
    // 返回创建的房间信息
    return saved;
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
  async getRoomById(id: number) {
    // 查找房间
    const room = await this.roomRepo.findOneBy({ id });
    // 房间不存在则抛出异常
    if (!room) throw new NotFoundException('房间不存在');
    // 返回房间信息
    return room;
  }

  // 删除房间（同时删除该房间所有成员和消息）
  async deleteRoom(roomId: number) {
    // 先检查房间是否存在
    const room = await this.roomRepo.findOneBy({ id: roomId });
    if (!room) throw new NotFoundException('房间不存在');
    // 删除房间所有消息
    await this.messageRepo.delete({ roomId });
    // 删除房间所有成员
    await this.memberRepo.delete({ roomId });
    // 删除房间本身
    await this.roomRepo.delete({ id: roomId });
    return true;
  }

  // ==================== 成员管理 ====================

  // 加入房间方法：验证房间存在性，检查是否已在房间中，然后添加成员
  async joinRoom(roomId: number, userId: number, username: string) {
    // 检查房间是否存在
    const room = await this.roomRepo.findOneBy({ id: roomId });
    if (!room) throw new NotFoundException('房间不存在');
    // 检查用户是否已在房间中
    const existing = await this.memberRepo.findOneBy({ roomId, userId });
    if (existing) throw new BadRequestException('您已在该房间中');
    // 添加成员到房间
    return this.memberRepo.save({
      roomId,                // 房间 ID
      userId,                // 用户 ID
      username,              // 用户名
      joinedAt: Date.now(),  // 加入时间戳
    });
  }

  // 离开房间方法：从数据库中删除成员记录
  async leaveRoom(roomId: number, userId: number) {
    // 删除成员记录
    await this.memberRepo.delete({ roomId, userId });
  }

  // 获取房间成员列表
  async getRoomMembers(roomId: number) {
    // 查询房间所有成员，按加入时间升序
    return this.memberRepo.find({
      where: { roomId },
      order: { joinedAt: 'ASC' },
    });
  }

  // 获取用户所在的所有房间
  async getUserRooms(userId: number) {
    // 查询用户的所有成员记录
    const members = await this.memberRepo.find({
      where: { userId },
      order: { joinedAt: 'DESC' },
    });
    // 提取房间 ID 列表
    const roomIds = members.map(m => m.roomId);
    // 无房间则返回空数组
    if (roomIds.length === 0) return [];
    // 批量查询房间信息（TypeORM 0.3+ 使用 findBy + In 替代 findByIds）
    return this.roomRepo.findBy({ id: In(roomIds) });
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

  // 获取房间历史消息（分页）
  async getMessages(dto: QueryMessagesDto) {
    const { roomId, page = 1, limit = 50 } = dto;  // 解构参数，设默认值
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
