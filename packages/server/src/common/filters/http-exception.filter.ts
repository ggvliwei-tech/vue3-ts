import {
  ExceptionFilter, // 异常过滤器接口
  Catch, // 异常捕获装饰器
  ArgumentsHost, // 参数主机，用于获取请求上下文
  HttpException, // HTTP 异常基类
  HttpStatus, // HTTP 状态码枚举
} from '@nestjs/common';

// 声明此过滤器只捕获 HttpException 类型的异常
@Catch(HttpException)
// 实现 ExceptionFilter 接口，定义异常处理逻辑
export class HttpExceptionFilter implements ExceptionFilter {
  // 异常捕获方法，当 HttpException 被抛出时执行
  // exception: 被捕获的异常对象
  // host: 参数主机，可以获取请求和响应对象
  catch(exception: HttpException, host: ArgumentsHost) {
    // 切换到 HTTP 上下文，获取请求和响应对象
    const ctx = host.switchToHttp();
    // 获取 Express 响应对象
    const response = ctx.getResponse();
    // 获取异常对应的 HTTP 状态码（如 400, 401, 404 等）
    const status = exception.getStatus();
    // 获取异常返回的消息内容
    const errMsg = exception.getResponse();

    // 注意这里返回 HTTP 200，但用业务 code 表示错误状态
    // 将异常信息以 JSON 格式返回给客户端
    response.status(HttpStatus.OK).json({
      code: status, // 业务状态码等于 HTTP 状态码
      // 消息可能是字符串或对象，这里兼容两种格式
      msg: typeof errMsg === 'string' ? errMsg : (errMsg as any).message,
      data: null, // 错误时 data 为 null
    });
  }
}
