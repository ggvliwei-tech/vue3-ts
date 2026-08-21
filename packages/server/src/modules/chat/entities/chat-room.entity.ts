import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// 聊天房间实体类，对应数据库 chat_room 表
@Entity('chat_room')
export class ChatRoomEntity {
  // 主键，自增 ID
  @PrimaryGeneratedColumn()
  id: number;

  // 房间名称，最大长度 100
  @Column({ length: 100, comment: '房间名称' })
  name: string;

  // 创建人用户 ID
  @Column({ comment: '创建人用户ID' })
  creatorId: number;

  // 创建时间，毫秒时间戳
  @Column({ type: 'bigint', comment: '创建时间(毫秒时间戳)' })
  createdAt: number;
}
