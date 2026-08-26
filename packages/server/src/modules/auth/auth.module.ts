// NestJS 模块装饰器
import { Module } from '@nestjs/common'
// 登录风控服务
import { LoginThrottlerService } from './login-throttler.service'
// 多设备会话管理服务
import { SessionService } from './session.service'

/**
 * 鉴权模块：登录风控、IP 限流、账号锁定、多设备会话
 */
@Module({
  providers: [LoginThrottlerService, SessionService],
  exports: [LoginThrottlerService, SessionService],
})
export class AuthModule {}
