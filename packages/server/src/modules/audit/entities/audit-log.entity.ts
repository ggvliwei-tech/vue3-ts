// TypeORM 装饰器
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm'

/**
 * 审计日志实体
 * 记录登录、退出、踢下线、状态切换、密码重置等关键事件
 */
@Entity('sys_audit_log')
export class AuditLog {
  // 主键 ID，自增
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string

  // 操作用户 ID（未登录场景为 NULL）
  @Column({ type: 'int', name: 'user_id', nullable: true })
  userId: number | null

  // 操作用户名（冗余存储，避免关联查询）
  @Column({ type: 'varchar', length: 50, nullable: true })
  username: string | null

  // 动作编码：login/logout/refresh/kick/toggle-status/reset-password 等
  @Index('idx_audit_action')
  @Column({ type: 'varchar', length: 50 })
  action: string

  // 操作对象类型（user/role/...）
  @Column({ type: 'varchar', length: 50, nullable: true })
  resource: string | null

  // 操作对象 ID
  @Column({ type: 'varchar', length: 50, name: 'resource_id', nullable: true })
  resourceId: string | null

  // 客户端 IP
  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null

  // User-Agent
  @Column({ type: 'varchar', length: 255, name: 'user_agent', nullable: true })
  userAgent: string | null

  // 状态：1 成功 / 0 失败
  @Column({ type: 'tinyint' })
  status: 0 | 1

  // 扩展信息（JSON 字符串）
  @Column({ type: 'json', nullable: true })
  detail: Record<string, any> | null

  // 创建时间（毫秒时间戳）
  @Index('idx_audit_time')
  @CreateDateColumn({ type: 'bigint', name: 'createTime' })
  createTime: number
}
