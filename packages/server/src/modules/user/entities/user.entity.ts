// Entity 实体装饰器，将类标记为 TypeORM 实体，映射到数据库表
import {
  Entity,
  // Column 列装饰器，将类属性映射到数据库字段，可配置类型、长度等
  Column,
  // PrimaryGeneratedColumn 主键装饰器，定义自增主键
  PrimaryGeneratedColumn,
  // Unique 唯一约束装饰器，确保指定字段值唯一
  Unique,
} from 'typeorm';

// Entity 装饰器声明此类为 TypeORM 实体，对应数据库表名为 sys_user
@Entity('sys_user')
// Unique 装饰器为 username 字段添加唯一约束，防止重复用户名
@Unique(['username'])
export class User {
  // PrimaryGeneratedColumn 装饰器定义自增主键，由数据库自动生成，无需手动赋值
  @PrimaryGeneratedColumn()
  id!: number;

  // Column 装饰器定义用户名字段，length: 50 限制最大 50 个字符，comment 为数据库字段注释
  @Column({ length: 50, comment: '用户名' })
  username!: string;

  // Column 装饰器定义密码字段，length: 100 存储 bcrypt 哈希值，comment 为数据库字段注释
  @Column({ length: 100, comment: '密码' })
  password!: string;

  // Column 装饰器定义用户状态字段，default: 1 默认值为 1（正常），0 表示禁用
  @Column({ default: 1, comment: '状态 1正常 0禁用' })
  status!: number;

  // Column 装饰器定义创建时间字段，type: 'bigint' 存储毫秒级时间戳
  @Column({ type: 'bigint', comment: '创建时间(毫秒时间戳)' })
  createTime!: number;

  // Column 装饰器定义手机号字段，length: 20 限制最大 20 个字符（支持国际号码），comment 为数据库字段注释
  @Column({ length: 20, comment: '手机号' })
  phone!: string;
}
