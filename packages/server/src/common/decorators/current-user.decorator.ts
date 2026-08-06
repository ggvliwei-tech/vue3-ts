// createParamDecorator 用于创建参数装饰器
// ExecutionContext 提供执行上下文信息
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// 自定义 @CurrentUser() 参数装饰器
// 用于在控制器方法中便捷地获取当前认证用户信息
export const CurrentUser = createParamDecorator(
  // 工厂函数：接收 data（装饰器参数）和 ctx（执行上下文）
  (data: unknown, ctx: ExecutionContext) => {
    // 切换到 HTTP 上下文并获取请求对象
    const request = ctx.switchToHttp().getRequest();
    // 返回挂载在请求对象上的 user 属性
    // 该值由 JwtAuthGuard 在验证 Token 后挂载
    return request.user;
  },
);
