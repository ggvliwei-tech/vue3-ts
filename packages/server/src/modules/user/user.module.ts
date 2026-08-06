// NestJS 模块装饰器
import { Module } from '@nestjs/common';
// TypeORM 模块，用于注册实体 Repository
import { TypeOrmModule } from '@nestjs/typeorm';
// 用户服务，处理业务逻辑
import { UserService } from './user.service';
// 用户控制器，处理 HTTP 请求
import { UserController } from './user.controller';
// 用户实体类，映射数据库表
import { User } from './entities/user.entity';

// 用户模块定义，封装用户相关功能
@Module({
  imports: [
    // 注册 User 实体到当前模块，使 UserService 可以注入 UserRepository
    // forFeature 只注册当前模块需要的实体，与根模块的 forRootAsync 配合使用
    TypeOrmModule.forFeature([User]),
  ],
  controllers: [UserController], // 注册控制器，处理路由和请求
  providers: [UserService], // 注册服务，处理数据库操作和业务逻辑
  exports: [UserService], // 导出 UserService，供其他模块（如 JwtAuthGuard）注入使用
})
export class UserModule {}
