import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// 聊天消息实体类，对应数据库 chat_message 表
@Entity('chat_message')
export class ChatMessageEntity {
  // 主键，自增 ID
  @PrimaryGeneratedColumn()
  id: number;

  // 房间 ID
  @Column({ comment: '房间ID' })
  roomId: number;

  // 发送者用户 ID
  @Column({ comment: '发送者用户ID' })
  senderId: number;

  // 发送者用户名
  @Column({ length: 50, comment: '发送者用户名' })
  senderName: string;

  // 消息内容，最大长度 2000
  @Column({ length: 2000, comment: '消息内容' })
  content: string;

  // 发送时间，毫秒时间戳
  @Column({ type: 'bigint', comment: '发送时间(毫秒时间戳)' })
  createdAt: number;
}
