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
          // 设置本地上传文件的根目录路径。
          // 必须给默认值：path.resolve 的参数校验很严格，传 undefined 会直接抛
          // TypeError（The "paths[1]" argument must be of type string），
          // 而这里是模块初始化阶段，抛出去就是进程起不来 —— 容器环境很容易踩到
          // （docker-compose 早期版本没传这两个变量，表现是后端容器反复重启）。
          // 默认值与 local.storage.ts 保持一致，改一处记得改另一处。
          rootPath: path.resolve(process.cwd(), config.get<string>('LOCAL_UPLOAD_BASE_DIR') || 'uploads'),
          // 设置静态资源的访问路由前缀。同样兜底，否则会拼出 "undefined/xxx" 的图片地址
          serveRoot: config.get<string>('LOCAL_STATIC_PREFIX') || '/uploads',
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
