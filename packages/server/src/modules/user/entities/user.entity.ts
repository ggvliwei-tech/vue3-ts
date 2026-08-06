import {
  Entity, // 实体装饰器，将类映射到数据库表
  Column, // 列装饰器，将属性映射到数据库字段
  PrimaryGeneratedColumn, Unique, // 主键装饰器，定义自增主键
} from 'typeorm';

// 声明此类为 TypeORM 实体，对应数据库表名为 sys_user
@Entity('sys_user')
@Unique(['username'])
export class User {
  // 主键字段，使用自增策略（由数据库自动生成，无需初始化）
  @PrimaryGeneratedColumn()
  id!: number;

  // 用户名字段，最大长度 50，数据库注释为 "用户名"
  @Column({ length: 50, comment: '用户名' })
  username!: string;

  // 密码字段，最大长度 100，存储 bcrypt 哈希值
  @Column({ length: 100, comment: '密码' })
  password!: string;

  // 用户状态字段，默认值为 1（正常），0 表示禁用
  @Column({ default: 1, comment: '状态 1正常 0禁用' })
  status!: number;


  // 新增：刷新令牌
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '刷新Token' })
  refreshToken: string | null;

  // 创建时间字段，类型为时间戳，默认值为数据库当前时间
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createTime!: Date;
}
