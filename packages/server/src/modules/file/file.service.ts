// 导入依赖注入装饰器和异常类
import { Injectable, BadRequestException } from '@nestjs/common';
// 导入配置服务，用于读取环境变量配置
import { ConfigService } from '@nestjs/config';
// 导入 Repository 注入装饰器
import { InjectRepository } from '@nestjs/typeorm';
// 导入 TypeORM 仓储接口，用于数据库操作
import { Repository } from 'typeorm';
// 导入 sharp 图片处理库，用于图片压缩
import sharp from 'sharp';
// 导入存储类型枚举
import { StorageTypeEnum } from './enums/storage-type.enum';
// 导入本地存储实现
import { LocalStorage } from './interfaces/local.storage';
// 导入 OSS 云存储实现
import { OssStorage } from './interfaces/oss.storage';
// 导入文件存储接口和上传结果类型
import { FileStorage, UploadResult } from './interfaces/file-storage.interface';
// 导入文件实体类
import { FileEntity } from './entities/file.entity';

// 允许上传的图片后缀正则
const ALLOW_IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp)$/i;
// 允许上传的 MIME 类型列表
const ALLOW_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// 标记为可注入的服务
@Injectable()
export class FileService {
  // 当前使用的存储策略，根据配置动态切换
  private storage: FileStorage;

  // 构造函数注入依赖
  constructor(
    private configService: ConfigService, // 注入配置服务
    @InjectRepository(FileEntity)
    private fileRepo: Repository<FileEntity>, // 注入文件实体 Repository
    private localStorage: LocalStorage, // 注入本地存储实现
    private ossStorage: OssStorage, // 注入 OSS 云存储实现
  ) {
    // 根据环境变量自动切换存储策略
    const type = this.configService.get<StorageTypeEnum>('STORAGE_TYPE');
    // 如果配置为 OSS 则使用云存储，否则使用本地存储
    this.storage = type === StorageTypeEnum.OSS ? this.ossStorage : this.localStorage;
  }

  /**
   * 分页查询文件列表
   */
  async findAll(page = 1, limit = 10, module?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (module) {
      where.module = module;
    }
    const [list, total] = await this.fileRepo.findAndCount({
      where,
      skip,
      take: limit,
      order: { createTime: 'DESC' },
    });
    return {
      list,
      total,
      page,
      limit,
    };
  }

  /**
   * 单文件上传 + 图片压缩 + 入库
   */
  async uploadSingle(
    file: Express.Multer.File, // 上传的文件对象
    module = 'common', // 文件归属模块标识
    compress = true, // 是否开启图片压缩
    uploadUserId?: number, // 上传人用户ID
  ) {
    // 1. 基础校验：检查文件缓冲区是否存在
    if (!file?.buffer) {
      throw new BadRequestException('文件缓冲区为空，上传失败');
    }
    // 提取文件扩展名
    const ext = file.originalname.substring(file.originalname.lastIndexOf('.'));
    // 校验文件扩展名和 MIME 类型是否合法
    if (!ALLOW_IMAGE_EXT.test(ext) || !ALLOW_MIME.includes(file.mimetype)) {
      throw new BadRequestException('仅支持 jpg、png、gif、webp 图片格式');
    }

    // 初始化上传缓冲区为原始文件缓冲区
    let uploadBuffer = file.buffer;

    // 2. 图片压缩（默认开启，长边最大1920）
    if (compress && file.mimetype.startsWith('image/')) {
      // 使用 sharp 压缩图片：限制最大宽高 1920，保持比例，不放大
      uploadBuffer = await sharp(file.buffer)
        .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
        .toBuffer();
    }

    // 3. 调用存储策略上传文件
    const res: UploadResult = await this.storage.upload(
      { ...file, buffer: uploadBuffer }, // 传入压缩后的文件缓冲区
      module,                            // 模块标识
    );

    // 4. 数据库写入记录
    const record = this.fileRepo.create({
      originalName: file.originalname,        // 原始文件名
      saveName: res.saveName,                 // 服务器保存的文件名
      filePath: res.filePath, // 存储相对路径
      url: res.url,                           // 可访问的 URL
      mimeType: file.mimetype,                // 文件 MIME 类型
      size: uploadBuffer.length,              // 压缩后的文件大小
      storageType: this.configService.get('STORAGE_TYPE'), // 当前使用的存储类型
      module,                                 // 归属模块
      uploadUserId,                           // 上传人用户ID
      createTime: Date.now(),                 // 上传时间
    });
    // 保存记录到数据库
    await this.fileRepo.save(record);

    return record;
  }

  /**
   * 删除文件（物理删除+数据库软删/硬删）
   */
  async deleteFile(id: number) {
    // 根据 ID 查询文件记录
    const file = await this.fileRepo.findOneBy({ id });
    // 如果文件不存在，抛出异常
    if (!file) throw new BadRequestException('文件不存在');

    // 删除云端/本地物理文件
    if (file.filePath) {
      await this.storage.delete(file.filePath);
    }
    // 删除数据库记录
    await this.fileRepo.delete(id);
    return true;
  }
}
