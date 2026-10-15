// 导入依赖注入装饰器
import { Injectable } from '@nestjs/common';
// 导入配置服务，用于读取阿里云 OSS 配置
import { ConfigService } from '@nestjs/config';
// 导入阿里云 OSS SDK
import OSS from 'ali-oss';
// 导入上传结果和文件存储接口
import { UploadResult, FileStorage } from './file-storage.interface';
// 导入随机文件名生成工具（local / oss 两个实现共用，避免其中一处被改漏）
import { generateRandomFileName } from '../../../common/utils/random-filename.util';

// 标记为可注入的服务，实现 FileStorage 接口
@Injectable()
export class OssStorage implements FileStorage {
  // OSS 客户端实例，初始化为 null
  private client: OSS | null = null;
  // CDN 域名前缀，用于拼接文件访问 URL
  private cdnDomain: string;
  // OSS 上传文件夹前缀
  private uploadFolder: string;

  // 构造函数注入配置服务，并初始化 CDN 域名和上传文件夹
  constructor(private configService: ConfigService) {
    // 获取 CDN 域名配置
    this.cdnDomain = <string>this.configService.get('OSS_CDN_DOMAIN');
    // 获取 OSS 上传文件夹配置
    this.uploadFolder = <string>this.configService.get('OSS_UPLOAD_FOLDER');
  }

  // 获取 OSS 客户端实例，使用懒加载模式初始化
  private getClient(): OSS {
    // 如果客户端未初始化，则创建新实例
    if (!this.client) {
      this.client = new OSS({
        region: this.configService.get('OSS_REGION'),                  // OSS 所在区域
        accessKeyId: <string>this.configService.get('OSS_ACCESS_KEY_ID'),      // 访问密钥 ID
        accessKeySecret: <string>this.configService.get('OSS_ACCESS_KEY_SECRET'), // 访问密钥 Secret
        bucket: this.configService.get('OSS_BUCKET'),                  // OSS Bucket 名称
      });
    }
    return this.client;
  }

  // 上传文件到阿里云 OSS
  async upload(file: Express.Multer.File, folder = ''): Promise<UploadResult> {
    // 获取当前日期
    const date = new Date();
    // 生成年/月/日格式的文件夹路径
    const dateFolder = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    // 生成唯一文件名：密码学随机 + 扩展名，防止覆盖与枚举（见 random-filename.util.ts）
    const saveName = generateRandomFileName(file.originalname);

    // 拼接 OSS 存储路径，去除多余的斜杠
    const ossKey = `${this.uploadFolder}/${folder}/${dateFolder}/${saveName}`.replace(/\/+/g, '/');

    // 将文件缓冲区上传到 OSS。
    // 必须显式带上 mime：ali-oss 的 put 在不传 mime 时会写 application/octet-stream，
    // 结果是图片经 CDN 打开变成"下载"而不是渲染 —— 本地存储由 nginx 按后缀推断，
    // 所以只有走 OSS 才会暴露这个问题。
    await this.getClient().put(ossKey, file.buffer, { mime: file.mimetype });

    // 拼接文件可访问的 CDN URL
    const url = `${this.cdnDomain}/${ossKey}`;

    // 返回上传结果
    return {
      filePath: ossKey, // OSS 存储路径
      url,              // 文件访问 CDN URL
      saveName,         // 服务器保存的文件名
    };
  }

  // 删除阿里云 OSS 上的文件
  async delete(filePath: string): Promise<boolean> {
    // 调用 OSS SDK 删除指定路径的文件
    await this.getClient().delete(filePath);
    return true;
  }
}
