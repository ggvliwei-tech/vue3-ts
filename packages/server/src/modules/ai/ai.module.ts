/**
 * AI 模块
 *
 * 模块拆分为三个职责单一的子服务 + 一个编排服务：
 *  - LlmProviderService  策略模式封装 LLM 客户端与 embeddings
 *  - RagService          PDF 解析 + Chroma 向量库
 *  - AiChatHistoryService 会话历史持久化（Redis + MySQL）
 *  - AiService           编排对话流程，供 AiController 调用
 *
 * 四个服务都只在本模块内消费，无需 exports。
 */
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AiService } from './ai.service'
import { AiController } from './ai.controller'
import { RedisModule } from '../redis/redis.module'
import { AiSessionEntity } from './entities/ai-session.entity'
import { AiMessageEntity } from './entities/ai-message.entity'
import { LlmProviderService } from './llm/llm-provider.service'
import { RagService } from './rag/rag.service'
import { AiChatHistoryService } from './chat-history/ai-chat-history.service'

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    TypeOrmModule.forFeature([AiSessionEntity, AiMessageEntity]),
  ],
  providers: [
    LlmProviderService,    // LLM 客户端策略
    RagService,            // RAG 向量库
    AiChatHistoryService,  // 会话历史持久化
    AiService,             // 编排服务
  ],
  controllers: [AiController],
})
export class AiModule {}
