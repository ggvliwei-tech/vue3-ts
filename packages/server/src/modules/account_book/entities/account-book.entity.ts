import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('account_book')
export class AccountBookEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, comment: '网站名称' })
  websiteName: string;

  @Column({ length: 255, default: '', comment: '网站地址' })
  websiteUrl: string;

  @Column({ length: 100, comment: '登录账号' })
  loginAccount: string;

  @Column({ length: 255, comment: '登录密码' })
  loginPassword: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', comment: '创建时间' })
  createdAt: Date;


  @Column({ comment: '创建人用户ID' })
  userId: number;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
    comment: '修改时间',
  })
  updatedAt: Date;
}
