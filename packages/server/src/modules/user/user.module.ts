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
// 审计日志模块，提供 AuditService / AuditSubscriber（C5：审计通过事件解耦）
import { AuditModule } from '../audit/audit.module';
// C5 拆分后的两个服务
import { UserService } from './user.service';
import { AuthService } from './auth.service';
import { UserCrudService } from './user-crud.service';
// 用户控制器，处理 HTTP 请求和路由
import { UserController } from './user.controller';
// 用户实体类，映射数据库表结构
import { User } from './entities/user.entity';

/**
 * UserModule（C5 拆分后）
 *
 * 提供：
 *  - AuthService       登录 / 刷新 / 退出 / 强制下线 / 会话管理
 *  - UserCrudService   用户注册 / 查询 / 状态切换 / 重置密码
 *  - UserService       兼容门面（Façade），将上述两个服务组合对外暴露
 *
 * 控制器与其他模块只需继续注入 UserService 即可保持原行为，
 * 新代码建议直接注入 AuthService / UserCrudService。
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
  providers: [AuthService, UserCrudService, UserService],
  // 全部导出：JwtAuthGuard 等底层场景可按需注入具体服务
  exports: [AuthService, UserCrudService, UserService],
})
export class UserModule {}
