// 导入 TypeORM 实体装饰器和列装饰器
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

// 定义权限实体，映射数据库表 sys_permission
@Entity('sys_permission')
export class PermissionEntity {
  // 主键，自增 ID
  @PrimaryGeneratedColumn()
  id: number;

  // 权限编码：user:list / user:kick / book:create / ...
  @Column({ length: 100, comment: '权限编码' })
  code: string;

  // 权限名称（中文显示用）
  @Column({ length: 100, comment: '权限名称' })
  name: string;

  // 所属模块：user / book / file / ai
  @Index()
  @Column({ length: 50, comment: '所属模块' })
  module: string;

  // 权限描述
  @Column({ length: 255, nullable: true, comment: '权限描述' })
  description: string;

  // 创建时间，毫秒时间戳
  @Column({ type: 'bigint', comment: '创建时间(毫秒时间戳)' })
  createTime: number;
}
