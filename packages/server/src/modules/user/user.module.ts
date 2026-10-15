// NestJS 模块装饰器，用于定义和封装功能模块
import { Module } from '@nestjs/common';
// TypeORM 模块，用于注册实体 Repository 到模块中
import { TypeOrmModule } from '@nestjs/typeorm';
// 短信模块，提供验证码服务
import { SmsModule } from '../sms/sms.module';
// RBAC 模块，提供角色和权限查询
import { RbacModule } from '../rbac/rbac.module';
// 鉴权模块，提供登录风控/限流/账号锁定 + 多设备会话
import { AuthModule } from '../auth/auth.module';
// 审计日志模块，提供 AuditService / AuditSubscriber（审计通过事件解耦）
import { AuditModule } from '../audit/audit.module';
// 职责单一的两个服务
import { AuthService } from './auth.service';
import { UserCrudService } from './user-crud.service';
// 用户控制器，处理 HTTP 请求和路由
import { UserController } from './user.controller';
// 用户实体类，映射数据库表结构
import { User } from './entities/user.entity';

/**
 * UserModule
 *
 * 提供两个职责单一的服务：
 *  - AuthService       登录 / 刷新 / 退出 / 强制下线 / 会话管理
 *  - UserCrudService   用户注册 / 查询 / 状态切换 / 重置密码
 *
 * 调用方按用途注入其中之一：
 *  - UserController                                 两者都用
 *  - RefreshTokenGuard / ChatGateway                UserCrudService（查用户实体）
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    SmsModule,
    AuthModule,
    AuditModule,
    RbacModule,
  ],
  controllers: [UserController],
  providers: [AuthService, UserCrudService],
  // 导出给 UserController 之外的消费方（RefreshTokenGuard / ChatGateway）
  exports: [AuthService, UserCrudService],
})
export class UserModule {}
