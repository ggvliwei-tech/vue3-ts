// 导入 NestJS 核心依赖
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
// 注入 NestJS 的反射器，用于读取装饰器元数据
import { Reflector } from '@nestjs/core'
// 引入角色装饰器常量
import { ROLES_KEY } from '../decorators/roles.decorator'

/**
 * 角色守卫：校验当前用户的角色编码是否在 @Roles(...) 列表中
 *
 * 工作流程：
 *  1. 通过 Reflector 读取当前 handler/class 上的 @Roles 元数据
 *  2. 若无 @Roles 装饰器（required 为空），直接放行
 *  3. 否则从 request.user.roles 中取出用户的角色编码数组
 *  4. 求交集：用户角色 ∩ 所需角色，只要有一个匹配即放行
 *  5. 不匹配则抛 403
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 读取 @Roles 装饰器参数（数组），未配置则为空数组
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(), // 方法级装饰器优先
      context.getClass(),    // 类级装饰器兜底
    ]) || []

    // 没有 @Roles 装饰器 → 不做角色限制，放行
    if (requiredRoles.length === 0) return true

    // 从 HTTP 请求对象中获取 JwtAuthGuard 挂载的 payload
    const req = context.switchToHttp().getRequest()
    const user = req.user
    // 未登录或 payload 无 roles 字段 → 拒绝
    if (!user || !Array.isArray(user.roles)) {
      throw new ForbiddenException('角色信息缺失，请重新登录')
    }

    // 求交集：用户拥有任一所需角色即通过
    const hasRole = user.roles.some((r: string) => requiredRoles.includes(r))
    if (!hasRole) {
      throw new ForbiddenException(`需要角色：${requiredRoles.join(', ')}`)
    }
    return true
  }
}
