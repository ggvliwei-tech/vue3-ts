// 导入依赖注入装饰器和异常类
import { Injectable, BadRequestException } from '@nestjs/common';
// 导入配置服务，用于读取环境变量配置
import { ConfigService } from '@nestjs/config';
// 导入 OpenAI 聊天模型和嵌入模型
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
// 导入 Ollama 本地聊天模型
import { ChatOllama } from '@langchain/ollama';
// 导入 LangChain 消息类型：人类消息、系统消息、AI 消息
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
// 导入 LangChain 文档类型
import { Document } from '@langchain/core/documents';
// 导入 Redis 客户端
import Redis from 'ioredis';
// 导入 LLM 类型枚举
import { LlmTypeEnum } from './enums/llm-type.enum';
// 导入文件系统模块
import fs from 'fs';
// 导入 PDF 解析库
import { PDFParse } from 'pdf-parse';
// 导入 Chroma 向量数据库客户端
import { ChromaClient } from 'chromadb';

// 标记为可注入的服务
@Injectable()
export class AiService {
  // 大语言模型实例，支持 OpenAI 或 Ollama
  private readonly llm: ChatOpenAI | ChatOllama;
  // 文本嵌入模型，用于向量相似度计算
  private embeddings: OpenAIEmbeddings;
  // Redis 客户端，用于存储聊天历史
  private readonly redisClient: Redis;
  // 当前使用的 LLM 类型标识
  private readonly llmType: string;

  // 构造函数注入配置服务，并初始化所有依赖
  constructor(private configService: ConfigService) {
    // 1. 初始化 Redis
    const redisPassword = this.configService.get('REDIS_PASSWORD');
    this.redisClient = new Redis({
      host: this.configService.get('REDIS_HOST') || 'localhost',       // Redis 主机地址
      port: this.configService.get('REDIS_PORT') || 6379,             // Redis 端口
      password: redisPassword || undefined,                           // Redis 密码
      lazyConnect: true,                                              // 延迟连接，首次使用时才连接
      retryStrategy: (times) => {
        // 重试策略：失败超过 3 次停止重试
        if (times > 3) {
          console.warn('[Redis] 连接失败次数过多，停止重试');
          return null;
        }
        // 指数退避：每次间隔增长，最大 2 秒
        return Math.min(times * 500, 2000);
      },
    });

    // 监听 Redis 错误事件
    this.redisClient.on('error', (err) => {
      console.error('[Redis] 连接错误:', err.message);
    });

    // 监听 Redis 连接成功事件
    this.redisClient.on('ready', () => {
      console.log('[Redis] 连接成功');
    });

    // 2. 判断使用哪种大模型
    this.llmType = this.configService.get('LLM_TYPE') || 'openai';
    if (this.llmType === LlmTypeEnum.OPENAI) {
      // 使用 OpenAI 兼容 API
      this.llm = new ChatOpenAI({
        apiKey: this.configService.get('OPENAI_API_KEY'),                                // API 密钥
        configuration: { baseURL: this.configService.get('OPENAI_BASE_URL') },           // API 基础 URL
        model: this.configService.get('OPENAI_MODEL') || 'gpt-3.5-turbo',               // 模型名称
        temperature: 0.6,                                                                // 温度参数，控制回复创造性
      });
      // 初始化 OpenAI 嵌入模型
      this.embeddings = new OpenAIEmbeddings({
        openAIApiKey: this.configService.get('OPENAI_API_KEY'),
        configuration: { baseURL: this.configService.get('OPENAI_BASE_URL') },
      });
    } else if (this.llmType === LlmTypeEnum.DASHSCOPE) {
      // 阿里云 DashScope 通义千问（OpenAI 兼容格式）
      this.llm = new ChatOpenAI({
        apiKey: this.configService.get('DASHSCOPE_API_KEY'),                             // DashScope API 密钥
        configuration: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }, // DashScope API 地址
        model: this.configService.get('DASHSCOPE_MODEL') || 'qwen-plus',                // 模型名称
        temperature: 0.6,
      });
      // DashScope 也支持 embeddings，使用相同的 API key
      this.embeddings = new OpenAIEmbeddings({
        openAIApiKey: this.configService.get('DASHSCOPE_API_KEY'),
        configuration: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      });
    } else {
      // Ollama 本地模型（不支持 embeddings，RAG 功能不可用）
      this.llm = new ChatOllama({
        baseUrl: this.configService.get('OLLAMA_BASE_URL'),   // Ollama 服务地址
        model: this.configService.get('OLLAMA_MODEL'),        // Ollama 模型名称
        temperature: 0.6,
        numCtx: 2048, // 减少上下文长度以降低内存占用
      });
      // Ollama 不支持 embeddings，设为 undefined
      this.embeddings = undefined as unknown as OpenAIEmbeddings;
    }
  }

  // ====================== 1. 单轮简单问答（无历史） ======================
  async simpleChat(question: string) {
    // 构建消息数组：系统提示词 + 用户问题
    const messages = [
      new SystemMessage('你是后端全栈工程师，回答简洁，提供可直接运行代码，不要冗余描述'),
      new HumanMessage(question),
    ];
    // 调用 LLM 获取回复
    const res = await this.llm.invoke(messages);
    // 返回回复内容
    return res.content;
  }

  // ====================== 2. 多轮对话（Redis 持久化历史） ======================
  async chatWithHistory(question: string, sessionId: string) {
    // 构建 Redis 存储键
    const historyKey = `chat_history:${sessionId}`;
    // 从 Redis 获取历史消息
    const historyData = await this.redisClient.get(historyKey);
    // 初始化消息数组，包含系统提示词
    const messages: Array<SystemMessage | HumanMessage | AIMessage> = [
      new SystemMessage('你是后端全栈工程师，回答简洁，提供可直接运行代码，不要冗余描述'),
    ];

    // 如果有历史消息，解析并添加到消息数组
    if (historyData) {
      // 解析 JSON 格式的历史消息
      const history = JSON.parse(historyData) as Array<{ type: string; content: string }>;
      // 遍历历史消息，按类型转换为对应消息对象
      for (const msg of history) {
        if (msg.type === 'human') {
          messages.push(new HumanMessage(msg.content));
        } else if (msg.type === 'ai') {
          messages.push(new AIMessage(msg.content));
        }
      }
    }

    // 添加当前用户问题到消息数组
    messages.push(new HumanMessage(question));
    // 调用 LLM 获取包含上下文的回复
    const res = await this.llm.invoke(messages);

    // 保存历史到 Redis（保留最近 10 轮对话，即 20 条消息）
    const updatedHistory = [
      ...JSON.parse(historyData || '[]'),          // 原有历史消息
      { type: 'human', content: question },        // 新增用户问题
      { type: 'ai', content: res.content },        // 新增 AI 回复
    ].slice(-20);                                  // 只保留最近 20 条
    // 存入 Redis，设置过期时间 86400 秒（24 小时）
    await this.redisClient.set(historyKey, JSON.stringify(updatedHistory), 'EX', 86400);

    return res.content;
  }

  // ====================== 3. RAG 知识库：上传 PDF 构建向量库 ======================
  async uploadPdfToVector(filePath: string, collectionName = 'business_docs') {
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) throw new BadRequestException('文件不存在');
    // 读取文件缓冲区
    const buffer = fs.readFileSync(filePath);
    // 创建 PDF 解析实例
    const parser = new PDFParse({ data: buffer });
    // 提取 PDF 文本内容
    const pdfRes = await parser.getText();
    const text = pdfRes.text;

    // 简单文本切块（替代 RecursiveCharacterTextSplitter）
    const chunkSize = 600;       // 每个文本块最大字符数
    const chunkOverlap = 80;     // 文本块重叠字符数
    const chunks: string[] = [];
    let start = 0;
    // 按固定大小切分文本
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push(text.slice(start, end));
      start = end - chunkOverlap; // 重叠部分避免信息丢失
    }

    // 将文本块转换为 LangChain 文档格式
    const docs = chunks.map((chunk, i) => new Document({ pageContent: chunk, metadata: { chunk: i } }));

    // 存入 Chroma 向量库（需要运行 Chroma 服务器）
    const client = new ChromaClient({
      host: this.configService.get('CHROMA_HOST') || 'localhost',
      port: this.configService.get('CHROMA_PORT') || 8000,
    });
    // 获取或创建集合
    const collection = await client.getOrCreateCollection({ name: collectionName });

    // 生成嵌入并添加文档
    const texts = docs.map(d => d.pageContent);
    // 使用嵌入模型将文本转换为向量
    const embeddings = await this.embeddings.embedDocuments(texts);

    // 将向量添加到集合中
    await collection.add({
      ids: docs.map((_, i) => `doc_${Date.now()}_${i}`), // 生成唯一 ID
      embeddings,                                          // 向量数据
      documents: texts,                                    // 原始文本
      metadatas: docs.map(d => d.metadata),                // 元数据
    });

    return true;
  }

  // ====================== 4. RAG 基于文档问答 ======================
  async ragQuery(question: string, collectionName = 'business_docs') {
    // 连接 Chroma 向量数据库
    const client = new ChromaClient({
      host: this.configService.get('CHROMA_HOST') || 'localhost',
      port: this.configService.get('CHROMA_PORT') || 8000,
    });
    // 获取集合
    const collection = await client.getOrCreateCollection({ name: collectionName });

    // 将用户问题转换为向量（嵌入）
    const questionEmbedding = await this.embeddings.embedQuery(question);

    // 在集合中查询最相似的 3 个文档
    const queryResult = await collection.query({
      queryEmbeddings: [questionEmbedding], // 查询向量
      nResults: 3,                          // 返回结果数量
      include: ['documents'],               // 包含原始文档内容
    });

    // 提取查询结果中的文档内容
    const relevantDocs = queryResult.documents?.[0] || [];
    // 将相关文档拼接为上下文
    const context = relevantDocs.join('\n\n');

    // 构建包含上下文的提示词
    const prompt = `
基于下面参考内容回答问题，不知道就如实回答不知道，禁止编造内容：
【参考上下文】
${context}
【用户问题】
${question}
    `;

    // 调用简单问答方法获取回复
    return this.simpleChat(prompt);
  }

  // ====================== 5. SSE 流式打字机输出（核心体验） ======================
  async streamChat(question: string) {
    // 使用 LLM 的流式输出功能
    const stream = await this.llm.stream([
      new SystemMessage('回答简短精炼'),
      new HumanMessage(question),
    ]);
    // 返回流式数据
    return stream;
  }
}
