// 导入 NestJS 模块装饰器
import { Module } from '@nestjs/common';
// 导入 JWT 模块
import { JwtModule } from '@nestjs/jwt';
// 导入配置模块
import { ConfigModule } from '@nestjs/config';
// 导入 WebSocket 网关，处理 WebSocket 连接和消息
import { ChatGateway } from './chat.gateway';

// WebSocket 模块定义，封装实时通信功能
@Module({
  imports: [JwtModule, ConfigModule], // 导入依赖模块
  providers: [ChatGateway], // 注册 WebSocket 网关
  exports: [ChatGateway],   // 导出 WebSocket 网关，供其他模块注入使用
})
export class ChatModule {}
