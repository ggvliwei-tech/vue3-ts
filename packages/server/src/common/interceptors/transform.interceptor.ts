// NestJS 可注入装饰器和拦截器相关类型
import {
  Injectable, // 依赖注入装饰器
  NestInterceptor, // 拦截器接口
  ExecutionContext, // 执行上下文，包含请求和响应信息
  CallHandler, // 调用处理器，用于将请求传递给下一个处理器
} from '@nestjs/common';
// RxJS Observable 类型，用于处理异步数据流
import { Observable } from 'rxjs';
// map 操作符，用于转换 Observable 发出的值
import { map } from 'rxjs/operators';

// 标记为可注入的服务类
@Injectable()
// 实现 NestInterceptor 接口，定义响应转换逻辑
export class TransformInterceptor implements NestInterceptor {
  // 拦截方法，在控制器处理请求前后执行
  // context: 当前请求的执行上下文
  // next: 调用处理器，调用后将请求转发给控制器
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    // next.handle() 将请求传递给控制器，返回一个 Observable
    // pipe 用于对 Observable 结果进行管道处理
    return next.handle().pipe(
      // map 操作符拦截控制器的返回值，并转换为统一格式
      map((data) => {
        // 返回统一的响应格式：状态码 200、成功消息、实际数据
        return {
          code: 200, // 业务状态码，200 表示成功
          msg: '请求成功', // 提示消息
          data, // 控制器返回的实际数据
        };
      }),
    );
  }
}
