// 导入 NestJS 的 SetMetadata 用于自定义元数据
import { SetMetadata } from '@nestjs/common'

// 定义元数据 key，用于 PermissionsGuard 反射读取
export const PERMISSIONS_KEY = 'permissions'

/**
 * 权限装饰器：标记接口需要的权限编码列表
 *
 * 语义是 **AND**：必须同时拥有列出的**全部**权限码才放行，缺一个即 403。
 * （实现见 permissions.guard.ts 的 `requiredPerms.filter(p => !user.permissions.includes(p))`。
 *  需要 OR 语义就写多个接口分别标注，不要指望这里「给一个就能过」。）
 *
 * @example
 *   @Permissions('user:list')
 *   @Get('users')
 *   findAll() { ... }
 */
export const Permissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes)
