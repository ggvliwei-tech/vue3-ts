// 导入 TypeORM 实体装饰器和列装饰器
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

// 定义角色实体，映射数据库表 sys_role
@Entity('sys_role')
export class RoleEntity {
  // 主键，自增 ID
  @PrimaryGeneratedColumn()
  id: number;

  // 角色编码：admin / editor / user
  @Column({ length: 50, comment: '角色编码' })
  code: string;

  // 角色名称（中文显示用）
  @Column({ length: 50, comment: '角色名称' })
  name: string;

  // 角色描述
  @Column({ length: 255, nullable: true, comment: '角色描述' })
  description: string;

  // 状态：1 启用 / 0 禁用
  @Column({ type: 'tinyint', default: 1, comment: '状态 1启用 0禁用' })
  status: number;

  // 创建时间，毫秒时间戳
  @Column({ type: 'bigint', comment: '创建时间(毫秒时间戳)' })
  createTime: number;
}
