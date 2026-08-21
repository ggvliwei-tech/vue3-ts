// 导入 NestJS 模块装饰器
import { Module } from '@nestjs/common';
// 导入 TypeORM 模块，用于注册实体 Repository
import { TypeOrmModule } from '@nestjs/typeorm';
// 导入静态资源托管模块，用于本地文件访问
import { ServeStaticModule } from '@nestjs/serve-static';
// 导入配置模块和配置服务
import { ConfigModule, ConfigService } from '@nestjs/config';
// 导入 path 模块，用于处理文件路径
import * as path from 'path';

// 导入文件控制器，处理 HTTP 请求
import { FileController } from './file.controller';
// 导入文件服务，处理文件上传/删除业务逻辑
import { FileService } from './file.service';
// 导入文件实体类，映射数据库表
import { FileEntity } from './entities/file.entity';
// 导入本地存储实现
import { LocalStorage } from './interfaces/local.storage';
// 导入 OSS 云存储实现
import { OssStorage } from './interfaces/oss.storage';

// 文件模块定义，封装文件上传/下载/删除功能
@Module({ // 文件模块定义，封装文件上传/下载/删除功能
  imports: [ // 导入所需的外部模块
    // 注册 FileEntity 实体到当前模块
    TypeOrmModule.forFeature([FileEntity]),
    // 本地静态资源托管（访问上传图片URL）
    ServeStaticModule.forRootAsync({ // 异步配置静态资源托管
      imports: [ConfigModule], // 导入 ConfigModule 以便使用配置服务
      useFactory: (config: ConfigService) => [ // 工厂函数，根据配置返回静态资源选项
        {
          // 设置本地上传文件的根目录路径
          rootPath: path.resolve(process.cwd(), <string>config.get('LOCAL_UPLOAD_BASE_DIR')),
          // 设置静态资源的访问路由前缀
          serveRoot: <string>config.get('LOCAL_STATIC_PREFIX'),
          // 设置浏览器缓存时间为 30 天（毫秒）
          maxAge: 30 * 24 * 60 * 60 * 1000,
        }, // 静态资源托管配置对象结束
      ], // 工厂函数返回的数组结束
      inject: [ConfigService], // 注入 ConfigService 到工厂函数
    }), // ServeStaticModule.forRootAsync 配置结束
  ], // imports 数组结束
  controllers: [FileController], // 注册控制器，处理路由和请求
  providers: [FileService, LocalStorage, OssStorage], // 注册服务和存储策略实现
  exports: [FileService], // 导出 FileService，供其他模块注入使用
})
export class FileModule {} // 导出文件模块类，空类体表示无需额外逻辑
