// 导入 NestJS 核心依赖
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
// 注入 NestJS 的反射器
import { Reflector } from '@nestjs/core'
// 引入权限装饰器常量
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator'

/**
 * 权限守卫：校验当前用户是否拥有 @Permissions(...) 中声明的所有权限码
 *
 * 与 RolesGuard 的区别：
 *  - RolesGuard 基于"角色"粗粒度校验（如 admin）
 *  - PermissionsGuard 基于"权限码"细粒度校验（如 user:kick）
 *
 * 工作流程：
 *  1. 读取 @Permissions 元数据
 *  2. 无装饰器则放行
 *  3. 否则从 request.user.permissions 中取用户的所有权限码
 *  4. 必须包含全部所需权限码才放行（AND 语义）
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 读取 @Permissions 装饰器参数
    const requiredPerms = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) || []

    // 无 @Permissions 装饰器 → 不做权限限制
    if (requiredPerms.length === 0) return true

    // 从 request.user.permissions 取用户拥有的权限码
    const req = context.switchToHttp().getRequest()
    const user = req.user
    if (!user || !Array.isArray(user.permissions)) {
      throw new ForbiddenException('权限信息缺失，请重新登录')
    }

    // AND 语义：用户必须拥有全部所需权限码
    const missing = requiredPerms.filter((p) => !user.permissions.includes(p))
    if (missing.length > 0) {
      throw new ForbiddenException(`缺少权限：${missing.join(', ')}`)
    }
    return true
  }
}
