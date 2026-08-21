// 导入 TypeORM 实体装饰器
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
// 导入 class-transformer 的 Exclude 装饰器，用于序列化时排除敏感字段
import { Exclude } from 'class-transformer';

// 定义实体，映射数据库表 account_book
@Entity('account_book')
export class AccountBookEntity {
  // 主键，自动生成
  @PrimaryGeneratedColumn()
  id: number;

  // 网站名称字段，长度 100，添加列注释
  @Column({ length: 100, comment: '网站名称' })
  websiteName: string;

  // 网站地址字段，长度 255，默认为空字符串，添加列注释
  @Column({ length: 255, default: '', comment: '网站地址' })
  websiteUrl: string;

  // 登录账号字段，长度 100，添加列注释
  @Column({ length: 100, comment: '登录账号' })
  loginAccount: string;

  // 登录密码字段，长度 255，添加列注释
  @Column({ length: 255, comment: '登录密码' })
  // Exclude 装饰器：在响应序列化时排除此字段，防止密码泄露
  @Exclude()
  loginPassword: string;

  // 创建时间字段，类型为 bigint（毫秒时间戳），添加列注释
  @Column({ type: 'bigint', comment: '创建时间(毫秒时间戳)' })
  createdAt: number;

  // 创建人用户 ID 字段，添加列注释
  @Column({ comment: '创建人用户ID' })
  userId: number;

  // 修改时间字段，类型为 bigint（毫秒时间戳），添加列注释
  @Column({ type: 'bigint', comment: '修改时间(毫秒时间戳)' })
  updatedAt: number;
}
