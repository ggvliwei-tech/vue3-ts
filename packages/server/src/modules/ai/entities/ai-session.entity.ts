import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

// AI 会话实体类，对应数据库 ai_session 表
@Entity('ai_session')
@Index('uk_session_user', ['sessionId', 'userId'], { unique: true })
@Index('idx_user', ['userId'])
export class AiSessionEntity {
  // 主键，自增 ID
  @PrimaryGeneratedColumn()
  id: number;

  // 用户 ID（SQL 列名为 user_id）
  @Column({ name: 'user_id', comment: '用户ID' })
  userId: number;

  // 会话 UUID（SQL 列名为 session_id）
  @Column({ name: 'session_id', length: 36, comment: '会话UUID' })
  sessionId: string;

  // 会话标题（SQL 列名为 title）
  @Column({ length: 100, default: '新对话', comment: '会话标题' })
  title: string;

  // 创建时间，毫秒时间戳（SQL 列名为 created_at）
  @Column({ name: 'created_at', type: 'bigint', comment: '创建时间(毫秒时间戳)' })
  createdAt: number;

  // 更新时间，毫秒时间戳（SQL 列名为 updated_at）
  @Column({ name: 'updated_at', type: 'bigint', comment: '更新时间(毫秒时间戳)' })
  updatedAt: number;
}
