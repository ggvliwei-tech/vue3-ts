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

    // 兼容两种 user 格式：
    // 1. JWT payload: { sub, username }
    // 2. User 实体对象: { id, username, ... }
    const user = {
      // 优先取 payload.sub（JWT 格式），否则取 payload.id（实体对象格式）
      id: payload.sub || payload.id,
      // 获取用户名
      username: payload.username,
      // 展开原始载荷的所有字段
      ...payload,
    };

    // 如果传了字段名（如 @CurrentUser('username')），返回指定字段
    if (data) return user[data];
    // 否则返回完整的用户对象
    return user;
  },
);
