// 导入依赖注入装饰器和异常类
import { Injectable, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
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

/**
 * 图片文件魔术字节（magic bytes / 文件头）指纹
 * 仅依赖文件头前 12 字节即可判断真实格式，不信任客户端上传的 mimetype / 后缀
 * - JPEG:  FF D8 FF
 * - PNG:   89 50 4E 47 0D 0A 1A 0A
 * - GIF:   47 49 46 38 37/39 61 ('GIF87a' / 'GIF89a')
 * - WEBP:  52 49 46 46 ... 57 45 42 50 ('RIFF....WEBP')
 */
const IMAGE_MAGIC_BYTES: Array<{ mime: string; signature: number[] }> = [
  { mime: 'image/jpeg', signature: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', signature: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', signature: [0x52, 0x49, 0x46, 0x46] }, // 后续 4 字节 size，再后 'WEBP'
]

/**
 * 通过文件头前几字节检测真实 MIME 类型
 * 不匹配任何已知签名返回 null
 */
function detectImageTypeByMagic(buf: Buffer): string | null {
  for (const { mime, signature } of IMAGE_MAGIC_BYTES) {
    if (buf.length < signature.length) continue
    let ok = true
    for (let i = 0; i < signature.length; i++) {
      if (buf[i] !== signature[i]) {
        ok = false
        break
      }
    }
    if (!ok) continue
    // WEBP 需要进一步校验尾部 'WEBP' 标识（offset 8-11）
    if (mime === 'image/webp') {
      if (
        buf.length < 12 ||
        buf[8] !== 0x57 ||
        buf[9] !== 0x45 ||
        buf[10] !== 0x42 ||
        buf[11] !== 0x50
      ) {
        continue
      }
    }
    return mime
  }
  return null
}

// 标记为可注入的服务
@Injectable()
export class FileService {
  // 当前使用的存储策略，根据配置动态切换
  private storage: FileStorage;

  // 日志实例：上传/删除出现"半截状态"时要留下可追溯的线索
  private readonly logger = new Logger(FileService.name);

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
   *
   * 非 admin 用户**只能看到自己上传的文件**。
   * 此前这里只按 module 过滤、不按 uploadUserId，而同一模块的 remove() 却做了
   * 归属校验 —— 两者口径不一致：任何持 file:list 的人（内置 editor 角色即有）
   * 都能翻页枚举全站文件的 originalName 与可直接访问的 url，再逐个下载别人的私有文件。
   *
   * @param currentUser 当前登录用户，用于判定 admin 与归属过滤
   */
  async findAll(
    page = 1,
    limit = 10,
    module?: string,
    currentUser?: { id: number; roles?: string[] },
  ) {
    const skip = (page - 1) * limit;
    // 计算跳过的记录数（偏移量）
    const where: any = {};
    // 初始化查询条件对象
    if (module) {
      // 如果传入了模块参数
      where.module = module; // 按模块过滤
    }
    // 归属过滤：口径与 remove() 保持一致（admin 可看全部）
    // currentUser 缺省时不加过滤 —— 仅用于内部调用（如管理端聚合统计），
    // HTTP 入口（file.controller.ts）始终会传入，不存在绕过路径。
    const isAdmin = currentUser?.roles?.includes('admin') ?? false;
    if (currentUser && !isAdmin) {
      where.uploadUserId = currentUser.id;
    }
    const [list, total] = await this.fileRepo.findAndCount({
      // 查询数据并获取总数
      where, // 查询条件
      skip, // 跳过的记录数（分页偏移）
      take: limit, // 每页数量
      order: { createTime: 'DESC' }, // 按创建时间倒序排列
    });
    return {
      // 返回分页结果对象
      list, // 当前页数据列表
      total, // 总记录数
      page, // 当前页码
      limit, // 每页数量
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
    // 原始文件名长度校验。sys_file.original_name 是 VARCHAR(255)，客户端可以在
    // multipart 里放任意长度的 filename —— 超长时 MySQL 严格模式直接抛
    // ER_DATA_TOO_LONG，被全局过滤器兜成 500（用户看不出是文件名太长）。
    // 而且这个文件名是**先落盘再入库**的，等到入库才失败时文件已经在磁盘上了。
    // 在动手写盘之前就拦掉，报错也明确。
    if (file.originalname.length > 255) {
      throw new BadRequestException('文件名过长（最多 255 个字符）');
    }
    // 提取文件扩展名
    const ext = file.originalname.substring(file.originalname.lastIndexOf('.')); // 从原始文件名中提取扩展名
    // 扩展名仅作为辅助参考，最终以魔术字节为准（防 .php.jpg 这种欺骗）
    if (!ALLOW_IMAGE_EXT.test(ext)) {
      throw new BadRequestException('仅支持 jpg、png、gif、webp 图片格式');
    }
    // 通过文件头真实检测图片类型，不信任客户端 mimetype
    const realMime = detectImageTypeByMagic(file.buffer);
    if (!realMime || !ALLOW_MIME.includes(realMime)) {
      throw new BadRequestException('文件内容与图片格式不匹配');
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
    // mimetype 一并替换为魔术字节嗅探结果：OSS 分支会把它写成对象的 Content-Type，
    // 用客户端声明的值等于让上传方自己决定文件对外的响应类型
    const res: UploadResult = await this.storage.upload(
      { ...file, buffer: uploadBuffer, mimetype: realMime },
      module, // 模块标识
    );

    // 4. 数据库写入记录
    const record = this.fileRepo.create({
      originalName: file.originalname, // 原始文件名
      saveName: res.saveName, // 服务器保存的文件名
      filePath: res.filePath, // 存储相对路径
      url: res.url, // 可访问的 URL
      // 落库用魔术字节嗅探出的真实类型，而不是客户端声明的 file.mimetype ——
      // 上面的校验拦住的是「上传动作」，但库里这个字段会被下游（内联渲染 / 下载
      // Content-Type）当可信值使用，存客户端声明的值等于把校验绕过去了
      mimeType: realMime, // 文件 MIME 类型（服务端嗅探结果）
      size: uploadBuffer.length, // 压缩后的文件大小
      storageType: this.configService.get('STORAGE_TYPE'), // 当前使用的存储类型
      module, // 归属模块
      uploadUserId, // 上传人用户ID
      createTime: Date.now(), // 上传时间
    });
    // 保存记录到数据库。
    // 落库失败必须把刚上传的物理文件删掉再抛 —— 否则文件已经躺在磁盘/OSS 上，
    // 而库里没有任何记录指向它：没有 filePath、没有 url，任何清理流程都找不到它，
    // 也没人会来删。每次"上传成功但入库失败"就永久泄漏一个文件（本地是磁盘，
    // OSS 是按量计费）。
    try {
      await this.fileRepo.save(record);
    } catch (err) {
      try {
        await this.storage.delete(res.filePath);
      } catch (cleanupErr) {
        // 回滚本身失败：记录已经不存在了，这个文件成了孤儿。
        // 把路径打出来，让运维能手工清理，不要静默丢掉这条线索。
        this.logger.error(
          `[File] 入库失败且回滚物理文件失败，产生孤儿文件：path=${res.filePath} url=${res.url} —— ${(cleanupErr as Error).message}`,
          (cleanupErr as Error).stack,
        );
      }
      throw err;
    }

    return record;
  }

  /**
   * 删除文件（物理删除+数据库记录）
   * 所有权校验 —— 仅本人或 admin 角色可删
   * @param id 文件 ID
   * @param currentUser 当前登录用户（id + roles）
   */
  async deleteFile(
    id: number,
    currentUser: { id: number; roles?: string[] },
  ): Promise<boolean> {
    // 根据 ID 查询文件记录
    const file = await this.fileRepo.findOneBy({ id });
    // 如果文件不存在，抛出异常
    if (!file) throw new BadRequestException('文件不存在');

    // 所有权校验
    // - admin 角色可删除任意文件
    // - 其他用户只能删除自己上传的文件
    const isAdmin = currentUser.roles?.includes('admin') ?? false
    if (!isAdmin && file.uploadUserId !== currentUser.id) {
      throw new ForbiddenException('只能删除自己上传的文件')
    }

    // 删除顺序：**先物理文件，后数据库记录**。这个顺序不要调换。
    //
    // 两种顺序都可能在中间失败，但后果不对称：
    //  - 先物理后库（当前）：物理已删、删库失败 → 记录还在、指向一个不存在的文件。
    //    用户看到一张裂图，重试一次即可删掉。重试是安全的 —— 两个存储实现的
    //    delete 都对「文件已不存在」幂等（LocalStorage 先 existsSync 再 unlink，
    //    OSS 的 delete 对不存在的 key 也返回成功），不会因为文件没了就报错。
    //  - 先库后物理（反例）：记录已删、物理删除失败 → 记录没了，指针也就丢了，
    //    这个文件再也没法被任何流程找到并清理。而它的 URL 仍然有效、仍能公开访问
    //    （本地是 nginx 静态目录，无鉴权），于是用户以为"已删除"的文件实际还挂着。
    //    这是安全后果，比裂图严重得多，而且不可恢复。
    //
    // 因此这里选择"可能留下一条可重试的脏记录"，而不是"可能留下一个不可回收的
    // 公开文件"。
    if (file.filePath) {
      // 如果文件路径存在
      await this.storage.delete(file.filePath); // 调用存储策略删除物理文件
    }
    try {
      // 删除数据库记录
      await this.fileRepo.delete(id); // 根据 ID 删除数据库中的记录
    } catch (err) {
      // 物理文件已经删掉了，但记录没删成。这不算"什么都没发生"：
      // 该 URL 已经 404，而列表里还有这一条。把 id 与路径打出来，
      // 便于运维按图索骥清理，而不是留一条看不出所以然的 500。
      this.logger.error(
        `[File] 物理文件已删除但数据库记录删除失败：id=${id} path=${file.filePath} —— ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
    return true; // 返回删除成功标识
  }
}
