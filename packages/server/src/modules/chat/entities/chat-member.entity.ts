import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// 聊天房间成员实体类，对应数据库 chat_member 表
@Entity('chat_member')
export class ChatMemberEntity {
  // 主键，自增 ID
  @PrimaryGeneratedColumn()
  id: number;

  // 房间 ID
  @Column({ comment: '房间ID' })
  roomId: number;

  // 用户 ID
  @Column({ comment: '用户ID' })
  userId: number;

  // 用户名
  @Column({ length: 50, comment: '用户名' })
  username: string;

  // 加入时间，毫秒时间戳
  @Column({ type: 'bigint', comment: '加入时间(毫秒时间戳)' })
  joinedAt: number;
}
