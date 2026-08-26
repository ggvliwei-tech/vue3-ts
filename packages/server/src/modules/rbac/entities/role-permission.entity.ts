// 导入 TypeORM 实体装饰器
import { Entity, PrimaryColumn } from 'typeorm';

// 定义角色-权限关联实体（多对多中间表）
// 联合主键：(role_id, permission_id)
@Entity('sys_role_permission')
export class RolePermissionEntity {
  // 角色 ID（主键之一）
  @PrimaryColumn({ type: 'int', name: 'role_id' })
  roleId: number;

  // 权限 ID（主键之一）
  @PrimaryColumn({ type: 'int', name: 'permission_id' })
  permissionId: number;
}
