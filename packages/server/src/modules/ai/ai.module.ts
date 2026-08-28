/**
 * AI 模块（C4 重构后）
 *
 * 模块拆分为三个职责单一的子服务 + 一个编排服务：
 *  - LlmProviderService  策略模式封装 LLM 客户端与 embeddings
 *  - RagService          PDF 解析 + Chroma 向量库
 *  - AiChatHistoryService 会话历史持久化（Redis + MySQL）
 *  - AiService           编排对话流程，对外暴露原接口签名
 *
 * 导出 AiService 保持向后兼容，其他模块如需直接调用子服务，
 * 可按需 import 子模块。
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
  exports: [AiService, LlmProviderService, RagService, AiChatHistoryService],
})
export class AiModule {}
