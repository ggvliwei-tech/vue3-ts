import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

// 聊天房间成员实体类，对应数据库 chat_member 表
//
// 【语义】本表是**持久成员关系**（"谁有权看这个房间"），不是在线状态。
//  - 加入：幂等（chat.service.ts 的 joinRoom 用 INSERT IGNORE）
//  - 离开页面 / 断线：**不删行**。在线与否由 chat.gateway.ts 的 broadcastPresence
//    通过 Socket.IO fetchSockets() 实时算，与此表无关
//  - 只有用户显式「退出房间」（POST /chat/leave → removeMembership）或房间被删才删行
//
// 曾经这张表被同时当作授权依据和在线状态表，而成员行会在退出房间时被物理删除，
// 导致下次进入房间时 assertUserInRoom 必然 403（前端表现为「您不在该房间中」）。
@Entity('chat_member')
// 唯一键的权威定义在 nest-db.sql 的 uk_chat_member_room_user（app.module.ts 里
// synchronize: false，所以这条声明不会改现有表结构）。它在这里的作用是把不变量写进元数据：
//  joinRoom 的 INSERT IGNORE 只有配合唯一键才有意义，而没有这条声明时，
//  下一个维护者看到实体上没有任何索引，会以为可以随便插、或把它改成 save()/upsert()。
//  将来若启用 synchronize / migration:generate，也能由此得到正确的键。
@Index('uk_chat_member_room_user', ['roomId', 'userId'], { unique: true })
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
