import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sys_file')
export class FileEntity {
  @PrimaryGeneratedColumn('increment')
  id: number;

  // 原始文件名
  @Column({ length: 255 })
  originalName: string;

  // 服务器保存文件名
  @Column({ length: 255 })
  saveName: string;

  // 存储相对路径
  @Column({ length: 500 })
  filePath: string;

  // 可访问URL
  @Column({ length: 500 })
  url: string;

  // MIME类型 image/png
  @Column({ length: 100 })
  mimeType: string;

  // 文件大小 byte
  @Column({ type: 'bigint' })
  size: number;

  // 存储类型 local / oss
  @Column({ length: 20 })
  storageType: string;

  // 归属模块：avatar / goods / contract
  @Column({ nullable: true, length: 50 })
  module: string;

  // 上传人ID
  @Column({ nullable: true })
  uploadUserId: number;

  // 上传时间，存储毫秒时间戳
  @Column({ type: 'bigint', comment: '上传时间(毫秒时间戳)' })
  createTime: number;
}
