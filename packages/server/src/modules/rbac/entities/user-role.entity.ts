// 导入 TypeORM 实体装饰器
import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

// 定义用户-角色关联实体（多对多中间表）
// 联合主键：(user_id, role_id)
@Entity('sys_user_role')
export class UserRoleEntity {
  // 用户 ID（主键之一）
  @PrimaryColumn({ type: 'int', name: 'user_id' })
  userId: number;

  // 角色 ID（主键之一）
  @PrimaryColumn({ type: 'int', name: 'role_id' })
  roleId: number;

  // 角色反向查询索引
  @Index()
  @Column({ type: 'int', name: 'role_id', insert: false, update: false })
  roleIdIndex: number;

  // 关联时间，毫秒时间戳
  @Column({ type: 'bigint', comment: '创建时间(毫秒时间戳)' })
  createTime: number;
}
