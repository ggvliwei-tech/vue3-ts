// 导入 NestJS 模块装饰器
import { Global, Module } from '@nestjs/common'
// 导入 TypeORM 模块 forFeature 用于注册实体 Repository
import { TypeOrmModule } from '@nestjs/typeorm'
// 导入 RBAC 相关实体
import { RoleEntity } from './entities/role.entity'
import { PermissionEntity } from './entities/permission.entity'
import { UserRoleEntity } from './entities/user-role.entity'
import { RolePermissionEntity } from './entities/role-permission.entity'
// 导入 RBAC 服务
import { RbacService } from './rbac.service'

/**
 * RBAC 模块：提供角色、权限、关联表的数据访问能力
 *
 * 设为 @Global() 后，注入 RbacService 的其他模块（如 JwtAuthGuard）无需显式 import
 */
@Global()
@Module({
  imports: [
    // 注册 RBAC 相关实体到 TypeORM
    TypeOrmModule.forFeature([
      RoleEntity,
      PermissionEntity,
      UserRoleEntity,
      RolePermissionEntity,
    ]),
  ],
  // 提供 RbacService 给其他模块注入
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
