// NestJS 模块装饰器
import { Module } from '@nestjs/common'
// TypeORM 模块
import { TypeOrmModule } from '@nestjs/typeorm'

// 引入所有涉及的实体
import { User } from '../user/entities/user.entity'
import { RoleEntity } from '../rbac/entities/role.entity'
import { PermissionEntity } from '../rbac/entities/permission.entity'
import { UserRoleEntity } from '../rbac/entities/user-role.entity'
import { RolePermissionEntity } from '../rbac/entities/role-permission.entity'
import { AccountBookEntity } from '../account_book/entities/account-book.entity'
import { FileEntity } from '../file/entities/file.entity'
import { AuditLog } from '../audit/entities/audit-log.entity'

// 引入子模块
import { RbacModule } from '../rbac/rbac.module'
import { AuditModule } from '../audit/audit.module'

// 引入控制器与服务
import { RoleController } from './role/role.controller'
import { RoleService } from './role/role.service'
import { PermissionController } from './permission/permission.controller'
import { PermissionService } from './permission/permission.service'
import { UserRoleController } from './user-role/user-role.controller'
import { UserRoleService } from './user-role/user-role.service'
import { AuditAdminController } from './audit/audit-admin.controller'
import { DashboardController } from './dashboard/dashboard.controller'

/**
 * 管理端模块
 *
 * 集中提供后台管理所需的：
 *  - 角色管理（CRUD + 权限绑定）
 *  - 权限管理（CRUD）
 *  - 用户角色分配
 *  - 审计日志查询（管理端命名空间）
 *  - 仪表盘统计
 *
 * 所有路由前缀为 /admin/**，访问需要 admin 角色
 */
@Module({
  imports: [
    // 注册所有涉及的实体 Repository
    TypeOrmModule.forFeature([
      User,
      RoleEntity,
      PermissionEntity,
      UserRoleEntity,
      RolePermissionEntity,
      AccountBookEntity,
      FileEntity,
      AuditLog,
    ]),
    // RBAC 模块（RbacService 用于清理用户缓存）— 已标记 @Global()，理论上不用再导入
    RbacModule,
    // 审计模块（AuditService 用于埋点）
    AuditModule,
  ],
  controllers: [
    RoleController,
    PermissionController,
    UserRoleController,
    AuditAdminController,
    DashboardController,
  ],
  providers: [RoleService, PermissionService, UserRoleService],
})
export class AdminModule {}
