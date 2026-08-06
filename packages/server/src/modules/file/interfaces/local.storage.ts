// 导入文件系统模块，用于文件读写操作
import * as fs from 'fs';
// 导入路径处理模块
import * as path from 'path';
// 导入依赖注入装饰器
import { Injectable } from '@nestjs/common';
// 导入配置服务，用于读取环境变量配置
import { ConfigService } from '@nestjs/config';
// 导入上传结果和文件存储接口
import { UploadResult, FileStorage } from './file-storage.interface';

// 标记为可注入的服务，实现 FileStorage 接口
@Injectable()
export class LocalStorage implements FileStorage {
  // 本地存储的基础目录路径
  private readonly baseDir: string;
  // 静态资源访问的路由前缀
  private readonly staticPrefix: string;

  // 构造函数注入配置服务，并初始化存储路径
  constructor(private configService: ConfigService) {
    // 拼接绝对路径作为文件上传的根目录
    this.baseDir = path.resolve(process.cwd(), <string>this.configService.get('LOCAL_UPLOAD_BASE_DIR'));
    // 获取静态资源访问的路由前缀
    this.staticPrefix = <string>this.configService.get('LOCAL_STATIC_PREFIX');
    // 根目录不存在自动创建
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  // 上传文件到本地服务器
  async upload(file: Express.Multer.File, folder = ''): Promise<UploadResult> {
    // 按日期分文件夹，格式：upload/2026/07/30
    const date = new Date();
    // 生成年/月/日格式的文件夹路径
    const dateFolder = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    // 拼接完整的目标文件夹路径
    const targetFolder = path.join(this.baseDir, folder, dateFolder);

    // 如果目标文件夹不存在，自动创建
    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }

    // 生成唯一文件名：时间戳 + 随机字符串 + 扩展名，防止覆盖
    const ext = path.extname(file.originalname);
    const saveName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    // 拼接文件完整存储路径
    const fullPath = path.join(targetFolder, saveName);

    // 将文件缓冲区写入磁盘
    fs.writeFileSync(fullPath, file.buffer);

    // 生成相对路径，将反斜杠替换为正斜杠
    const relativePath = path.join(folder, dateFolder, saveName).replace(/\\/g, '/');
    // 拼接文件可访问的完整 URL
    const url = `${this.staticPrefix}/${relativePath}`;

    // 返回上传结果
    return {
      filePath: relativePath, // 存储相对路径
      url,                    // 文件访问 URL
      saveName,               // 服务器保存的文件名
    };
  }

  // 删除本地文件
  async delete(filePath: string): Promise<boolean> {
    // 拼接文件的完整物理路径
    const fullPath = path.resolve(this.baseDir, filePath);
    // 如果文件存在，则删除
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    return true;
  }
}
