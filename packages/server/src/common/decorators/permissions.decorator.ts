// 导入 NestJS 的 SetMetadata 用于自定义元数据
import { SetMetadata } from '@nestjs/common'

// 定义元数据 key，用于 PermissionsGuard 反射读取
export const PERMISSIONS_KEY = 'permissions'

/**
 * 权限装饰器：标记接口需要的权限编码列表（任一即可通过）
 * @example
 *   @Permissions('user:list')
 *   @Get('users')
 *   findAll() { ... }
 */
export const Permissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes)
