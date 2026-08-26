// 导入 NestJS 的 SetMetadata 用于自定义元数据
import { SetMetadata } from '@nestjs/common';

// 定义元数据 key，用于 RolesGuard 反射读取
export const ROLES_KEY = 'roles'

/**
 * 角色装饰器：标记接口允许访问的角色编码列表
 * @example
 *   @Roles('admin', 'editor')
 *   @Get('users')
 *   findAll() { ... }
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles)
