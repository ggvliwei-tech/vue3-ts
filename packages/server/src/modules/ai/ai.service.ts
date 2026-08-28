/**
 * AI 编排服务（AiService / AiOrchestratorService）
 *
 * C4 重构：原 537 行上帝服务拆分为三个职责单一的服务后，本类只承担
 * "对话流程编排"职责：协调 LLMProvider / RagService / AiChatHistory
 * 共同完成单轮、多轮、流式等不同形态的对话。
 *
 * 对外接口签名与拆分前完全兼容，Controller 无需改动。
 */
import { Injectable } from '@nestjs/common'
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import { LlmProviderService } from './llm/llm-provider.service'
import { RagService } from './rag/rag.service'
import { AiChatHistoryService, HistoryMessage } from './chat-history/ai-chat-history.service'

/** 默认系统提示词 */
const DEFAULT_SYSTEM_PROMPT = '你是后端全栈工程师，回答简洁，提供可直接运行代码，不要冗余描述'
/** 流式输出的轻量提示词 */
const STREAM_SYSTEM_PROMPT = '回答简短精炼'

@Injectable()
export class AiService {
  constructor(
    private readonly llmProvider: LlmProviderService,
    private readonly ragService: RagService,
    private readonly chatHistory: AiChatHistoryService,
  ) {}

  // ====================== 历史消息 → LangChain BaseMessage[] ======================

  private toBaseMessages(
    systemPrompt: string,
    history: HistoryMessage[],
    question: string,
  ): BaseMessage[] {
    const messages: BaseMessage[] = [new SystemMessage(systemPrompt)]
    for (const m of history) {
      if (m.type === 'human') messages.push(new HumanMessage(m.content))
      else if (m.type === 'ai') messages.push(new AIMessage(m.content))
    }
    messages.push(new HumanMessage(question))
    return messages
  }

  // ====================== 1. 单轮问答（无历史） ======================

  async simpleChat(question: string): Promise<string> {
    return this.llmProvider.invoke(DEFAULT_SYSTEM_PROMPT, question)
  }

  // ====================== 2. 多轮对话（持久化历史） ======================

  async chatWithHistory(question: string, sessionId: string, userId: string): Promise<string> {
    const history = await this.chatHistory.getHistory(userId, sessionId)
    const messages = this.toBaseMessages(DEFAULT_SYSTEM_PROMPT, history, question)
    const res = await this.llmProvider.invokeWithMessages(messages)
    const answer = typeof res.content === 'string' ? res.content : String(res.content)

    await this.chatHistory.appendHistory(userId, sessionId, question, answer, history)
    const session = await this.chatHistory.touchSession(userId, sessionId)
    await this.chatHistory.saveTurn(session.id, userId, question, answer)
    await this.chatHistory.setLastSession(userId, sessionId)

    return answer
  }

  // ====================== 3. RAG 检索问答 ======================

  async ragQuery(question: string): Promise<string> {
    const prompt = await this.ragService.buildPrompt(question)
    return this.llmProvider.invoke(DEFAULT_SYSTEM_PROMPT, prompt)
  }

  // ====================== 4. SSE 流式打字机（无历史） ======================

  streamChat(question: string) {
    return this.llmProvider.stream(STREAM_SYSTEM_PROMPT, question)
  }

  // ====================== 5. SSE 流式打字机（带历史 + 持久化） ======================

  async streamChatWithHistory(question: string, sessionId: string, userId: string) {
    const history = await this.chatHistory.getHistory(userId, sessionId)
    const messages = this.toBaseMessages(DEFAULT_SYSTEM_PROMPT, history, question)
    const stream = await this.llmProvider.streamWithMessages(messages)

    // 闭包共享变量：累积完整回复，供 finally 落库
    let fullResponse = ''

    async function* consume() {
      try {
        for await (const chunk of stream) {
          // 兼容 string / ContentBlock[] 两种 chunk.content 形态
          const c = chunk.content
          const text =
            typeof c === 'string'
              ? c
              : Array.isArray(c)
                ? c
                    .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
                    .map((b: any) => b.text)
                    .join('')
                : ''
          fullResponse += text
          yield chunk
        }
      } finally {
        // 即使消费者提前断开也要把已收到的内容持久化
        if (fullResponse) {
          await thisRef.persistTurn(question, fullResponse, history, userId, sessionId)
        }
      }
    }

    // 通过 thisRef 把编排服务引用传入闭包
    const thisRef = this
    return consume()
  }

  /** 把完整一轮对话持久化到 Redis + MySQL */
  private async persistTurn(
    question: string,
    answer: string,
    history: HistoryMessage[],
    userId: string,
    sessionId: string,
  ): Promise<void> {
    try {
      await this.chatHistory.appendHistory(userId, sessionId, question, answer, history)
      const session = await this.chatHistory.touchSession(userId, sessionId)
      await this.chatHistory.saveTurn(session.id, userId, question, answer)
      await this.chatHistory.setLastSession(userId, sessionId)
    } catch {
      // 持久化失败不应阻塞 SSE 客户端；调用方已收到内容
      // 此处静默吞掉，必要时可接入日志（避免每次都给前端抛错）
    }
  }

  // ====================== 6. 会话管理 ======================

  async recordLastSession(userId: string, sessionId: string): Promise<void> {
    await this.chatHistory.setLastSession(userId, sessionId)
    await this.chatHistory.touchSession(userId, sessionId)
  }

  listSessions(userId: string) {
    return this.chatHistory.listSessions(userId)
  }

  getLastSession(userId: string) {
    return this.chatHistory.getLastSession(userId)
  }

  getSessionMessages(userId: string, sessionId: string) {
    return this.chatHistory.getMessages(userId, sessionId)
  }

  async deleteSession(userId: string, sessionId: string): Promise<boolean> {
    return this.chatHistory.deleteSession(userId, sessionId)
  }

  async clearSessions(userId: string): Promise<void> {
    await this.chatHistory.clearAll(userId)
  }

  // ====================== 7. RAG 入库 ======================

  uploadPdfToVector(filePath: string, collectionName?: string) {
    return this.ragService.ingestPdf(filePath, collectionName)
  }
}
