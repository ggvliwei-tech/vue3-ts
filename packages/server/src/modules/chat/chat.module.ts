// 从 @nestjs/common 导入 Module 模块装饰器
import { Module } from '@nestjs/common';
// 从 @nestjs/typeorm 导入 TypeOrmModule，用于注册 Entity
import { TypeOrmModule } from '@nestjs/typeorm';
// 从 @nestjs/jwt 导入 JwtModule JWT 模块
import { JwtModule } from '@nestjs/jwt';
// 从 @nestjs/config 导入 ConfigModule 配置模块
import { ConfigModule } from '@nestjs/config';
// 导入 ChatGateway WebSocket 网关类
import { ChatGateway } from './chat.gateway';
// 导入 ChatService 服务类
import { ChatService } from './chat.service';
// 导入 ChatController 控制器类
import { ChatController } from './chat.controller';
// 导入三个 Entity 类
import { ChatRoomEntity } from './entities/chat-room.entity';
import { ChatMemberEntity } from './entities/chat-member.entity';
import { ChatMessageEntity } from './entities/chat-message.entity';

// @Module() 装饰器定义模块元数据
@Module({
  // 导入依赖模块
  imports: [
    // 注册三个 Entity，TypeORM 自动管理对应的数据库表
    TypeOrmModule.forFeature([ChatRoomEntity, ChatMemberEntity, ChatMessageEntity]),
    // JWT 模块用于 Token 验证
    JwtModule,
    // 配置模块用于读取环境变量
    ConfigModule,
  ],
  // 注册提供者可注入
  providers: [ChatGateway, ChatService],
  // 注册控制器处理 REST API
  controllers: [ChatController],
  // 导出 ChatGateway 和 ChatService 供其他模块使用
  exports: [ChatGateway, ChatService],
})
// 定义 ChatModule 类，封装聊天房间管理、WebSocket 实时通信和消息持久化功能
export class ChatModule {}
