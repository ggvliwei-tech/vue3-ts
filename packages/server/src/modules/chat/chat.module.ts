// 从 @nestjs/common 导入 Module 模块装饰器
import { Module } from '@nestjs/common';
// 从 @nestjs/jwt 导入 JwtModule JWT 模块
import { JwtModule } from '@nestjs/jwt';
// 从 @nestjs/config 导入 ConfigModule 配置模块
import { ConfigModule } from '@nestjs/config';
// 从同级目录导入 ChatGateway WebSocket 网关类
import { ChatGateway } from './chat.gateway';

// @Module() 装饰器定义模块元数据
@Module({
  imports: [JwtModule, ConfigModule], // 导入依赖模块：JWT 模块用于 Token 验证，配置模块用于读取配置
  providers: [ChatGateway], // 注册 ChatGateway 为可注入提供者
  exports: [ChatGateway],   // 导出 ChatGateway，供其他模块通过依赖注入使用
})
// 定义 ChatModule 类，封装 WebSocket 实时通信相关功能
export class ChatModule {}
