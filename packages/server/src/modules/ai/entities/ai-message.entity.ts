import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

// AI 消息实体类，对应数据库 ai_message 表
@Entity('ai_message')
@Index('idx_session', ['sessionId'])
@Index('idx_user', ['userId'])
export class AiMessageEntity {
  // 主键，自增 ID
  @PrimaryGeneratedColumn()
  id: number;

  // 会话 ID（关联 ai_session.id，SQL 列名为 session_id）
  @Column({ name: 'session_id', comment: '会话ID' })
  sessionId: number;

  // 用户 ID（SQL 列名为 user_id）
  @Column({ name: 'user_id', comment: '用户ID' })
  userId: number;

  // 消息角色：user 或 assistant
  @Column({ length: 20, comment: '角色: user/assistant' })
  role: string;

  // 消息内容（TEXT 类型，支持 AI 长回复）
  @Column({ type: 'text', comment: '消息内容' })
  content: string;

  // 发送时间，毫秒时间戳（SQL 列名为 created_at）
  @Column({ name: 'created_at', type: 'bigint', comment: '发送时间(毫秒时间戳)' })
  createdAt: number;
}
