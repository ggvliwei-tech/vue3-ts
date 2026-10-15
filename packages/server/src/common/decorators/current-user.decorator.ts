// createParamDecorator 用于创建参数装饰器
// ExecutionContext 提供执行上下文信息
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// 自定义 @CurrentUser() 参数装饰器
// 用于在控制器方法中便捷地获取当前认证用户信息
export const CurrentUser = createParamDecorator(
  // data: 装饰器参数，可指定返回用户对象的某个字段
  // ctx: 执行上下文，用于获取 HTTP 请求对象
  (data: string | undefined, ctx: ExecutionContext) => {
    // 切换到 HTTP 上下文并获取 Express 请求对象
    const request = ctx.switchToHttp().getRequest();
    // 从请求对象上获取 JWT 验证后挂载的用户载荷
    const payload = request.user;
    // 如果没有载荷数据，返回 null
    if (!payload) return null;

    // 统一以 JWT 载荷的 sub 作为用户 ID 来源。
    // JwtAuthGuard 与 RefreshTokenGuard 都会挂载 sub，并各自补齐 id / roles 等字段
    // （见两个 guard 里对 request.user 的赋值），故这里只需保证 id 与 sub 对齐。
    const user = {
      // 展开原始载荷的所有字段
      ...payload,
      // 用户 ID 以 sub 为准
      id: payload.sub,
    };

    // 如果传了字段名（如 @CurrentUser('username')），返回指定字段
    if (data) return user[data];
    // 否则返回完整的用户对象
    return user;
  },
);
