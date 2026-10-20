/**
 * LLM 提供方策略服务
 *
 * 从 AiService 抽出的 LLM 客户端创建与对话调用职责
 * 采用策略模式屏蔽 OpenAI / DashScope / Ollama 的差异，
 * 后续新增模型只需在本文件追加 case 分支即可，无需改动业务调用方。
 */
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai'
import { ChatOllama } from '@langchain/ollama'
import {
  SystemMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import { LlmTypeEnum } from '../enums/llm-type.enum'

/** LLM 类型联合：所有策略返回的客户端类型 */
export type LlmClient = ChatOpenAI | ChatOllama

/** 嵌入模型类型：Ollama 不支持原生 embeddings */
export type EmbeddingsClient = OpenAIEmbeddings | null

/** 嵌入模型不可用时的错误。reason 会原样展示给调用方，用于区分「没配 key」和「provider 不支持」 */
export class EmbeddingsUnavailableError extends Error {
  constructor(reason = '当前 LLM 不支持 embeddings，无法进行 RAG 向量化') {
    super(reason)
  }
}

@Injectable()
export class LlmProviderService {
  private readonly logger = new Logger(LlmProviderService.name)
  private readonly llm: LlmClient
  private readonly embeddings: EmbeddingsClient
  private readonly llmType: string
  /** embeddings 为 null 时的具体原因，避免运行时只剩一句笼统的「不可用」 */
  private embeddingsUnavailableReason: string | null = null

  constructor(private readonly configService: ConfigService) {
    this.llmType = this.configService.get('LLM_TYPE') || LlmTypeEnum.OPENAI
    const built = this.build(this.llmType)
    this.llm = built.llm
    this.embeddings = built.embeddings
  }

  /**
   * 标记 embeddings 不可用并返回 null。
   *
   * 构造期就把「缺 key」识别出来，而不是等用户上传 PDF 时才由 langchain 抛
   * `Missing credentials` —— 那种错误经全局过滤器会变成 500「系统内部错误」，
   * 看起来像后端 bug，实际只是环境变量没传进容器。
   */
  private disableEmbeddings(reason: string): null {
    this.embeddingsUnavailableReason = reason
    this.logger.warn(`知识库 embedding 不可用：${reason}`)
    return null
  }

  /**
   * 根据 LLM_TYPE 环境变量构造客户端
   */
  private build(type: string): { llm: LlmClient; embeddings: EmbeddingsClient } {
    if (type === LlmTypeEnum.OPENAI) {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY')
      const baseURL = this.configService.get<string>('OPENAI_BASE_URL')
      return {
        llm: new ChatOpenAI({
          apiKey,
          configuration: { baseURL },
          model: this.configService.get('OPENAI_MODEL') || 'gpt-3.5-turbo',
          temperature: 0.6,
        }),
        embeddings: apiKey
          ? new OpenAIEmbeddings({
              openAIApiKey: apiKey,
              configuration: { baseURL },
            })
          : this.disableEmbeddings('LLM_TYPE=openai 但 OPENAI_API_KEY 为空'),
      }
    }

    if (type === LlmTypeEnum.DASHSCOPE) {
      const apiKey = this.configService.get<string>('DASHSCOPE_API_KEY')
      const baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
      return {
        llm: new ChatOpenAI({
          apiKey,
          configuration: { baseURL },
          model: this.configService.get('DASHSCOPE_MODEL') || 'qwen-plus',
          temperature: 0.6,
        }),
        embeddings: apiKey
          ? new OpenAIEmbeddings({
              openAIApiKey: apiKey,
              configuration: { baseURL },
              // ⚠️ 必须显式指定：OpenAIEmbeddings 缺省会走 OpenAI 的
              //    text-embedding-ada-002，DashScope 的兼容端点不认这个模型名，
              //    即便 key 正确也会在首次上传时 400。
              //    换模型会导致已有向量维度不一致，公共库需要重建索引。
              model:
                this.configService.get<string>('DASHSCOPE_EMBEDDING_MODEL') ||
                'text-embedding-v3',
              // DashScope 兼容端点单次最多接受 10 条文本（实测 11 条即 400：
              // `batch size is invalid, it should not be larger than 10`）。
              // OpenAIEmbeddings 默认 batchSize=512 会一次性提交全部切块，
              // 稍微长一点的 PDF（>10 块）上传必失败 —— 必须显式压到 10。
              batchSize: 10,
            })
          : this.disableEmbeddings('LLM_TYPE=dashscope_qwen 但 DASHSCOPE_API_KEY 为空'),
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
      embeddings: this.disableEmbeddings('LLM_TYPE=local_ollama 不提供兼容 OpenAI 的 embedding 接口'),
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
    if (!this.embeddings) {
      throw new EmbeddingsUnavailableError(this.embeddingsUnavailableReason ?? undefined)
    }
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
