// NestJS 模块装饰器
import { Module } from '@nestjs/common';
// APP_INTERCEPTOR 用于全局注册拦截器
import { APP_INTERCEPTOR } from '@nestjs/core';
// class-transformer 序列化拦截器，配合 @Expose/@Exclude 使用
import { ClassSerializerInterceptor } from '@nestjs/common';
// 配置模块和服务，用于读取和管理环境变量
import { ConfigModule, ConfigService } from '@nestjs/config';
// TypeORM 数据库模块，用于连接和操作数据库
import { TypeOrmModule } from '@nestjs/typeorm';
// JWT 模块，用于 Token 的签发和验证
import { JwtModule, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
// 自定义配置加载函数
import configuration from './config/configuration';
// 用户功能模块
import { UserModule } from './modules/user/user.module';
import { AccountBookModule } from './modules/account_book/account-book.module';
import { FileModule } from './modules/file/file.module';
import { AiModule } from './modules/ai/ai.module';
import { ChatModule } from './modules/chat/chat.module';

// 根模块，负责组装所有全局依赖
@Module({
  imports: [
    // 配置模块：加载 .env 文件并注册自定义配置加载函数
    ConfigModule.forRoot({
      isGlobal: true, // 设为全局模块，其他模块无需重复导入即可使用 ConfigService
      load: [configuration], // 加载自定义配置函数，对环境变量做预处理
      envFilePath: '.env', // 指定环境变量文件路径
    }),

    // JWT 模块：异步注册配置，从 ConfigService 中读取密钥和过期时间
    JwtModule.registerAsync({
      // useFactory 工厂函数，接收注入的依赖返回 JWT 配置
      useFactory: (configService: ConfigService): JwtModuleOptions => ({
        // JWT 签名密钥，用于加密和解密 Token
        secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        // Token 签名选项
        signOptions: {
          // Token 过期时间，通过类型断言绕过 StringValue 类型限制
          expiresIn: configService.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN') as JwtSignOptions['expiresIn'],
        },
      }),
      inject: [ConfigService], // 注入 ConfigService 供 useFactory 使用
      global: true, // 设为全局模块，所有模块可直接使用 JwtService
    }),

    // TypeORM 数据库连接模块：异步读取配置创建 MySQL 连接
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        type: 'mysql', // 数据库类型
        host: configService.getOrThrow<string>('DB_HOST'), // 数据库主机地址
        port: configService.getOrThrow<number>('DB_PORT'), // 数据库端口号
        username: configService.getOrThrow<string>('DB_USER'), // 数据库用户名
        password: configService.getOrThrow<string>('DB_PWD'), // 数据库密码
        database: configService.getOrThrow<string>('DB_NAME'), // 数据库名称
        // 实体文件路径，TypeORM 会根据这些文件自动映射表结构
        entities: ['dist/**/*.entity{.ts,.js}'],
        synchronize: process.env.NODE_ENV !== 'production', // 非生产环境自动同步表结构
        logging: false, // 关闭 SQL 日志输出
        charset: 'utf8mb4', // 使用 utf8mb4 字符集，支持 emoji 等特殊字符
        supportBigNumbers: true,
        bigNumberStrings: false // 关键：关闭大数强制字符串
      }),
      inject: [ConfigService], // 注入 ConfigService 供 useFactory 使用
    }),

    // 导入用户模块，注册用户相关的控制器和服务
    UserModule,
    AccountBookModule,
    FileModule,
    AiModule,
    ChatModule
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ClassSerializerInterceptor,
    },
  ],
})
export class AppModule {}
