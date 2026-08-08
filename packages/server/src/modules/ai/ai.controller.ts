// 导入 NestJS 核心装饰器
import { Controller, Post, Body, Sse, MessageEvent, Get, Query } from '@nestjs/common';
// 导入 RxJS 相关操作符，用于流式数据处理
import { Observable, from, map } from 'rxjs';
// 导入 AI 服务，注入业务逻辑
import { AiService } from './ai.service';
// 导入聊天 DTO，定义请求数据结构
import { ChatDto } from './dto/chat.dto';
// 导入 LangChain 消息类型校验函数
import { isBaseMessage } from '@langchain/core/messages';
// 导入 UUID 生成函数
import { randomUUID } from 'crypto';

// 设置路由前缀为 /ai
@Controller('ai')
export class AiController {
  // 构造函数注入 AI 服务
  constructor(private readonly aiService: AiService) {}

  // 1. 普通单轮问答
  // POST /ai/chat 路由
  @Post('chat')
  async chat(@Body() dto: ChatDto) {
    // 调用服务层简单问答方法
    const data = await this.aiService.simpleChat(dto.question);
    // 返回统一响应格式（与 TransformInterceptor 保持一致，code: 0 表示成功）
    return { code: 0, data };
  }

  // 2. 带会话历史多轮对话
  // POST /ai/chat/history 路由
  @Post('chat/history')
  async chatHistory(@Body() dto: ChatDto) {
    // 不传 sessionId 时自动生成一个新的
    const sessionId = dto.sessionId || randomUUID();
    // 调用服务层带历史的问答方法
    const data = await this.aiService.chatWithHistory(dto.question, sessionId);
    // 返回统一响应格式，包含 sessionId（code: 0 表示成功）
    return { code: 0, data, sessionId };
  }

  // 3. RAG 知识库问答
  // POST /ai/rag 路由
  @Post('rag')
  async ragChat(@Body() dto: ChatDto) {
    // 调用服务层 RAG 问答方法
    const data = await this.aiService.ragQuery(dto.question);
    // 返回统一响应格式（code: 0 表示成功）
    return { code: 0, data };
  }

  // 4. SSE 流式输出（前端打字机效果）
  // GET /ai/stream 路由
  @Get('stream')
  @Sse() // Server-Sent Events 装饰器
  async stream(@Query('question') question: string): Promise<Observable<MessageEvent>> {
    // 调用服务层流式聊天方法
    const stream = await this.aiService.streamChat(question);
    // 将流数据转换为 SSE 消息事件格式
    return from(stream).pipe(
      map((chunk) => ({
        // 如果是 LangChain 消息则序列化 content，否则转为字符串
        data: isBaseMessage(chunk) ? JSON.stringify(chunk.content) : String(chunk),
      })),
    );
  }

  // 5. 生成新的会话ID
  // POST /ai/session/create 路由
  @Post('session/create')
  async createSession() {
    // 生成新的 UUID 作为 sessionId
    const sessionId = randomUUID();
    // 返回统一响应格式（code: 0 表示成功）
    return { code: 0, data: { sessionId } };
  }
}
