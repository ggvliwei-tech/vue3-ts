import { Module } from '@nestjs/common'; // NestJS 模块装饰器
import { APP_INTERCEPTOR } from '@nestjs/core'; // APP_INTERCEPTOR 用于全局注册拦截器
import { ClassSerializerInterceptor } from '@nestjs/common'; // class-transformer 序列化拦截器，配合 @Expose/@Exclude 使用
import { ConfigModule, ConfigService } from '@nestjs/config'; // 配置模块和服务，用于读取和管理环境变量
import { TypeOrmModule } from '@nestjs/typeorm'; // TypeORM 数据库模块，用于连接和操作数据库
import { JwtModule, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt'; // JWT 模块，用于 Token 的签发和验证
import { ThrottlerModule } from '@nestjs/throttler'; // 限流模块，用于接口频率限制
import configuration from './config/configuration'; // 自定义配置加载函数，对环境变量做预处理
import { UserModule } from './modules/user/user.module'; // 用户功能模块，处理用户相关业务逻辑
import { AccountBookModule } from './modules/account_book/account-book.module'; // 账本功能模块
import { FileModule } from './modules/file/file.module'; // 文件管理模块，处理上传下载
import { AiModule } from './modules/ai/ai.module'; // AI 功能模块
import { ChatModule } from './modules/chat/chat.module'; // 聊天对话模块

@Module({ // 根模块装饰器，负责组装所有全局依赖和配置
  imports: [ // 导入的模块列表
    ConfigModule.forRoot({ // 配置模块初始化
      isGlobal: true, // 设为全局模块，其他模块无需重复导入即可使用 ConfigService
      load: [configuration], // 加载自定义配置函数，对环境变量做预处理
      envFilePath: '.env', // 指定环境变量文件路径
    }),

    JwtModule.registerAsync({ // JWT 模块异步注册配置
      useFactory: (configService: ConfigService): JwtModuleOptions => ({ // 工厂函数，接收依赖返回 JWT 配置
        secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'), // JWT 签名密钥，用于加密和解密 Token
        signOptions: { // Token 签名选项配置
          expiresIn: configService.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN') as JwtSignOptions['expiresIn'], // Token 过期时间，类型断言绕过 StringValue 限制
        },
      }),
      inject: [ConfigService], // 注入 ConfigService 供 useFactory 使用
      global: true, // 设为全局模块，所有模块可直接使用 JwtService
    }),

    TypeOrmModule.forRootAsync({ // TypeORM 数据库连接模块异步注册
      useFactory: (configService: ConfigService) => ({ // 工厂函数，返回数据库连接配置
        type: 'mysql', // 数据库类型为 MySQL
        host: configService.getOrThrow<string>('DB_HOST'), // 数据库主机地址
        port: configService.getOrThrow<number>('DB_PORT'), // 数据库端口号
        username: configService.getOrThrow<string>('DB_USER'), // 数据库用户名
        password: configService.getOrThrow<string>('DB_PWD'), // 数据库密码
        database: configService.getOrThrow<string>('DB_NAME'), // 数据库名称
        entities: ['dist/**/*.entity{.ts,.js}'], // 实体文件路径，TypeORM 自动映射表结构
        synchronize: process.env.NODE_ENV !== 'production', // 非生产环境自动同步表结构
        logging: false, // 关闭 SQL 日志输出
        charset: 'utf8mb4', // 使用 utf8mb4 字符集，支持 emoji 等特殊字符
        supportBigNumbers: true, // 支持大数字类型
        bigNumberStrings: false // 关闭大数强制转字符串，保持数字类型
      }),
      inject: [ConfigService], // 注入 ConfigService 供 useFactory 使用
    }),

    // 全局限流配置（所有模块共享）
    ThrottlerModule.forRoot([
      {
        ttl: 10000, // 限流时间窗口为 10 秒
        limit: 5,   // 时间窗口内最大允许 5 次请求
      },
    ]),

    UserModule, // 导入用户模块，注册用户相关的控制器和服务
    AccountBookModule, // 导入账本模块，管理账本相关功能
    FileModule, // 导入文件模块，处理文件上传下载
    AiModule, // 导入 AI 模块，提供 AI 相关功能
    ChatModule // 导入聊天模块，处理聊天对话功能
  ],
  providers: [ // 全局服务提供者列表
    {
      provide: APP_INTERCEPTOR, // 注册为全局拦截器的 token
      useClass: ClassSerializerInterceptor, // 使用 class-transformer 序列化拦截器类
    },
  ],
})
export class AppModule {} // 导出根模块类，负责组装所有全局依赖
