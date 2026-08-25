// NestJS 模块装饰器，用于定义和封装功能模块
import { Module } from '@nestjs/common';
// TypeORM 模块，用于注册实体 Repository 到模块中
import { TypeOrmModule } from '@nestjs/typeorm';
// 短信模块，提供验证码服务
import { SmsModule } from '../sms/sms.module';
// 用户服务，处理数据库操作和业务逻辑
import { UserService } from './user.service';
// 用户控制器，处理 HTTP 请求和路由
import { UserController } from './user.controller';
// 用户实体类，映射数据库表结构
import { User } from './entities/user.entity';

// 使用 @Module 装饰器定义 UserModule 用户模块，封装用户相关功能
@Module({
  imports: [
    // 注册 User 实体到当前模块，使用 forFeature 只注册当前模块需要的实体
    // 与根模块的 forRootAsync 配合使用，使 UserService 可以注入 UserRepository
    TypeOrmModule.forFeature([User]),
    // 导入短信模块，UserService 需要注入 SmsService
    SmsModule,
  ],
  controllers: [UserController], // 注册控制器，负责处理 HTTP 路由和请求响应
  providers: [UserService], // 注册服务提供者，负责数据库操作和业务逻辑
  exports: [UserService], // 导出 UserService 服务，供其他模块（如 JwtAuthGuard）注入使用
})
export class UserModule {}
