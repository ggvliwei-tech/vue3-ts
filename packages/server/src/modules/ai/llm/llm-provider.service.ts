/**
 * LLM 提供方策略服务
 *
 * C4 拆分：将原 AiService 中 LLM 客户端创建与对话调用相关的职责抽出
 * 采用策略模式屏蔽 OpenAI / DashScope / Ollama 的差异，
 * 后续新增模型只需在本文件追加 case 分支即可，无需改动业务调用方。
 */
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai'
import { ChatOllama } from '@langchain/ollama'
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import { LlmTypeEnum } from '../enums/llm-type.enum'

/** LLM 类型联合：所有策略返回的客户端类型 */
export type LlmClient = ChatOpenAI | ChatOllama

/** 嵌入模型类型：Ollama 不支持原生 embeddings */
export type EmbeddingsClient = OpenAIEmbeddings | null

/** 嵌入模型不可用时的错误 */
export class EmbeddingsUnavailableError extends Error {
  constructor() {
    super('当前 LLM 不支持 embeddings，无法进行 RAG 向量化')
  }
}

@Injectable()
export class LlmProviderService {
  private readonly llm: LlmClient
  private readonly embeddings: EmbeddingsClient
  private readonly llmType: string

  constructor(private readonly configService: ConfigService) {
    this.llmType = this.configService.get('LLM_TYPE') || LlmTypeEnum.OPENAI
    const built = this.build(this.llmType)
    this.llm = built.llm
    this.embeddings = built.embeddings
  }

  /**
   * 根据 LLM_TYPE 环境变量构造客户端
   */
  private build(type: string): { llm: LlmClient; embeddings: EmbeddingsClient } {
    if (type === LlmTypeEnum.OPENAI) {
      return {
        llm: new ChatOpenAI({
          apiKey: this.configService.get('OPENAI_API_KEY'),
          configuration: { baseURL: this.configService.get('OPENAI_BASE_URL') },
          model: this.configService.get('OPENAI_MODEL') || 'gpt-3.5-turbo',
          temperature: 0.6,
        }),
        embeddings: new OpenAIEmbeddings({
          openAIApiKey: this.configService.get('OPENAI_API_KEY'),
          configuration: { baseURL: this.configService.get('OPENAI_BASE_URL') },
        }),
      }
    }

    if (type === LlmTypeEnum.DASHSCOPE) {
      return {
        llm: new ChatOpenAI({
          apiKey: this.configService.get('DASHSCOPE_API_KEY'),
          configuration: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
          model: this.configService.get('DASHSCOPE_MODEL') || 'qwen-plus',
          temperature: 0.6,
        }),
        embeddings: new OpenAIEmbeddings({
          openAIApiKey: this.configService.get('DASHSCOPE_API_KEY'),
          configuration: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
        }),
      }
    }

    // 默认 / local_ollama
    return {
      llm: new ChatOllama({
        baseUrl: this.configService.get('OLLAMA_BASE_URL'),
        model: this.configService.get('OLLAMA_MODEL'),
        temperature: 0.6,
        numCtx: 2048,
      }),
      embeddings: null,
    }
  }

  /** 暴露给编排服务使用 */
  getLlm(): LlmClient {
    return this.llm
  }

  getEmbeddings(): EmbeddingsClient {
    return this.embeddings
  }

  getLlmType(): string {
    return this.llmType
  }

  /** 业务侧断言 embeddings 可用 */
  requireEmbeddings(): OpenAIEmbeddings {
    if (!this.embeddings) throw new EmbeddingsUnavailableError()
    return this.embeddings
  }

  /**
   * 单轮对话：直接 invoke 返回字符串
   */
  async invoke(systemPrompt: string, question: string): Promise<string> {
    const res = await this.llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(question),
    ])
    return typeof res.content === 'string' ? res.content : String(res.content)
  }

  /**
   * 单轮流式对话：返回 LangChain 原生 stream
   */
  stream(systemPrompt: string, question: string) {
    return this.llm.stream([
      new SystemMessage(systemPrompt),
      new HumanMessage(question),
    ])
  }

  /**
   * 带历史的流式对话：把构造好的消息数组直接交给 LLM
   */
  streamWithMessages(messages: BaseMessage[]) {
    return this.llm.stream(messages)
  }

  /**
   * 带历史的同步对话：把构造好的消息数组直接交给 LLM
   */
  invokeWithMessages(messages: BaseMessage[]) {
    return this.llm.invoke(messages)
  }
}
