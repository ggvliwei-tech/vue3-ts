// createParamDecorator 用于创建参数装饰器
// ExecutionContext 提供执行上下文信息
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// 自定义 @CurrentUser() 参数装饰器
// 用于在控制器方法中便捷地获取当前认证用户信息
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const payload = request.user;
    if (!payload) return null;

    // 兼容两种 user 格式：
    // 1. JWT payload: { sub, username }
    // 2. User 实体对象: { id, username, ... }
    const user = {
      id: payload.sub || payload.id,
      username: payload.username,
      ...payload,
    };

    // 如果传了字段名（如 @CurrentUser('username')），返回指定字段
    if (data) return user[data];
    return user;
  },
);
