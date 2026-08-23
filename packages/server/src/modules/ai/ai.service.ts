// 导入 NestJS 常用装饰器：Injectable(可注入服务)、BadRequestException(请求异常)
import { Injectable, BadRequestException } from '@nestjs/common';
// 导入 NestJS 配置服务，用于读取环境变量
import { ConfigService } from '@nestjs/config';
// 导入 LangChain OpenAI 聊天模型和嵌入模型
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
// 导入 LangChain Ollama 聊天模型（本地部署）
import { ChatOllama } from '@langchain/ollama';
// 导入 LangChain 核心消息类型：人类消息、系统消息、AI 消息
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
// 导入 LangChain 文档类型，用于 RAG 向量检索
import { Document } from '@langchain/core/documents';
// 导入 LLM 类型枚举，定义支持的模型平台
import { LlmTypeEnum } from './enums/llm-type.enum';
// 导入 Redis 服务，用于会话历史持久化
import { RedisService } from '../redis/redis.service';
// 导入 Node.js 文件系统模块
import fs from 'fs';
// 导入 PDF 解析库
import { PDFParse } from 'pdf-parse';
// 导入 Chroma 向量数据库客户端
import { ChromaClient } from 'chromadb';

// Injectable 装饰器：标记该类为可注入的服务，由 NestJS 容器管理
@Injectable()
// AI 服务类：封装所有大语言模型相关业务逻辑
export class AiService {
  // LLM 实例属性，支持 OpenAI 兼容接口或 Ollama 本地模型
  private readonly llm: ChatOpenAI | ChatOllama;
  // 文本嵌入模型属性，用于向量相似度计算（Ollama 模式下不可用）
  private embeddings: OpenAIEmbeddings | null;
  // 当前使用的 LLM 类型标识字符串
  private readonly llmType: string;

  // 构造函数：注入配置服务和 Redis 服务
  constructor(
    private configService: ConfigService, // 配置服务，读取 .env 环境变量
    private redisService: RedisService, // Redis 服务，用于缓存和持久化
  ) {
    // 从配置中读取 LLM 类型，默认为 openai
    this.llmType = this.configService.get('LLM_TYPE') || 'openai';
    // 判断是否为 OpenAI 类型
    if (this.llmType === LlmTypeEnum.OPENAI) {
      // 创建 OpenAI 兼容 API 聊天模型实例
      this.llm = new ChatOpenAI({
        apiKey: this.configService.get('OPENAI_API_KEY'),                                // 从配置获取 API 密钥
        configuration: { baseURL: this.configService.get('OPENAI_BASE_URL') },           // 从配置获取 API 基础 URL（支持自定义端点）
        model: this.configService.get('OPENAI_MODEL') || 'gpt-3.5-turbo',               // 从配置获取模型名称，默认 gpt-3.5-turbo
        temperature: 0.6,                                                                // 温度参数 0.6，控制回复的随机性和创造性
      });
      // 创建 OpenAI 嵌入模型实例，用于文本向量化
      this.embeddings = new OpenAIEmbeddings({
        openAIApiKey: this.configService.get('OPENAI_API_KEY'), // 使用相同的 API 密钥
        configuration: { baseURL: this.configService.get('OPENAI_BASE_URL') }, // 使用相同的 API 基础 URL
      });
    // 判断是否为阿里云 DashScope 类型（通义千问，OpenAI 兼容格式）
    } else if (this.llmType === LlmTypeEnum.DASHSCOPE) {
      // 创建 DashScope 聊天模型实例（复用 ChatOpenAI 因为接口兼容）
      this.llm = new ChatOpenAI({
        apiKey: this.configService.get('DASHSCOPE_API_KEY'),                             // 从配置获取 DashScope API 密钥
        configuration: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }, // DashScope OpenAI 兼容 API 地址
        model: this.configService.get('DASHSCOPE_MODEL') || 'qwen-plus',                // 从配置获取模型名称，默认 qwen-plus
        temperature: 0.6, // 温度参数 0.6，控制回复创造性
      });
      // 创建 DashScope 嵌入模型实例（使用相同 API key 和端点）
      this.embeddings = new OpenAIEmbeddings({
        openAIApiKey: this.configService.get('DASHSCOPE_API_KEY'), // DashScope API 密钥
        configuration: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }, // DashScope API 地址
      });
    // 其他情况为 Ollama 本地模型
    } else {
      // 创建 Ollama 本地聊天模型实例
      this.llm = new ChatOllama({
        baseUrl: this.configService.get('OLLAMA_BASE_URL'),   // 从配置获取 Ollama 服务地址
        model: this.configService.get('OLLAMA_MODEL'),        // 从配置获取 Ollama 模型名称
        temperature: 0.6, // 温度参数 0.6
        numCtx: 2048, // 上下文窗口大小设为 2048，降低内存占用
      });
      // Ollama 本地模型不支持原生 embeddings，设为 null
      this.embeddings = null;
    }
  }

  // ====================== Redis Key 辅助方法 ======================

  // 生成会话历史 Redis Key 的私有方法
  private getSessionHistoryKey(userId: string, sessionId: string) {
    // 返回格式化的 Key：ai:session:用户ID:会话ID
    return `ai:session:${userId}:${sessionId}`;
  }

  // 生成最近会话 Redis Key 的私有方法
  private getLastSessionKey(userId: string) {
    // 返回格式化的 Key：ai:session:last:用户ID
    return `ai:session:last:${userId}`;
  }

  // 记录用户最近会话 ID 到 Redis 的公共方法
  async recordLastSession(userId: string, sessionId: string) {
    // 将会话信息以 JSON 格式存入 Redis，包含 sessionId 和时间戳，过期时间 7 天
    await this.redisService.setJson(
      this.getLastSessionKey(userId), // Redis Key
      { sessionId, updatedAt: Date.now() }, // 存储的数据：会话 ID 和更新时间
      604800, // TTL 过期时间为 604800 秒（7 天）
    );
  }

  // ====================== 1. 单轮简单问答（无历史） ======================

  // 单轮简单问答方法：不保留上下文，直接回答当前问题
  async simpleChat(question: string) {
    // 构建消息数组：包含系统提示词和用户问题
    const messages = [
      new SystemMessage('你是后端全栈工程师，回答简洁，提供可直接运行代码，不要冗余描述'), // 系统角色设定
      new HumanMessage(question), // 用户提问消息
    ];
    // 调用 LLM 的 invoke 方法，传入消息数组并等待回复
    const res = await this.llm.invoke(messages);
    // 返回 AI 回复的内容
    return res.content;
  }

  // ====================== 2. 多轮对话（Redis 持久化历史） ======================

  // 带历史上下文的多轮对话方法：使用 Redis 存储会话历史
  async chatWithHistory(question: string, sessionId: string, userId: string) {
    // 构建 Redis 存储键，通过 userId 和 sessionId 隔离不同用户和会话
    const historyKey = this.getSessionHistoryKey(userId, sessionId);
    // 从 Redis 以 JSON 格式获取历史消息数组
    const historyData = await this.redisService.getJson<Array<{ type: string; content: string }>>(historyKey);
    // 初始化消息数组，首先放入系统提示词
    const messages: Array<SystemMessage | HumanMessage | AIMessage> = [
      new SystemMessage('你是后端全栈工程师，回答简洁，提供可直接运行代码，不要冗余描述'), // 系统角色设定
    ];

    // 判断是否存在历史消息数据
    if (historyData) {
      // 遍历历史消息数组，逐条转换为对应消息对象
      for (const msg of historyData) {
        // 如果是人类消息类型，创建 HumanMessage 实例
        if (msg.type === 'human') {
          messages.push(new HumanMessage(msg.content));
        // 如果是 AI 消息类型，创建 AIMessage 实例
        } else if (msg.type === 'ai') {
          messages.push(new AIMessage(msg.content));
        }
      }
    }

    // 将当前用户问题追加到消息数组末尾
    messages.push(new HumanMessage(question));
    // 调用 LLM 的 invoke 方法，传入包含历史的完整消息数组
    const res = await this.llm.invoke(messages);

    // 构建更新后的历史消息数组
    const updatedHistory = [
      ...historyData || [],                       // 展开原有历史消息，如果没有则为空数组
      { type: 'human', content: question },       // 追加当前用户问题
      { type: 'ai', content: res.content },       // 追加当前 AI 回复
    ].slice(-20);                                 // 截取最后 20 条消息（保留最近 10 轮对话）
    // 将更新后的历史以 JSON 格式存入 Redis，过期时间 86400 秒（24 小时）
    await this.redisService.setJson(historyKey, updatedHistory, 86400);
    // 更新用户最近会话记录
    await this.recordLastSession(userId, sessionId);

    // 返回 AI 回复内容
    return res.content;
  }

  // ====================== 3. RAG 知识库：上传 PDF 构建向量库 ======================

  // 上传 PDF 并解析后存入 Chroma 向量库的方法
  async uploadPdfToVector(filePath: string, collectionName = 'business_docs') {
    // 检查文件路径是否存在，不存在则抛出请求异常
    if (!fs.existsSync(filePath)) throw new BadRequestException('文件不存在');
    // 同步读取文件内容为 Buffer 缓冲区
    const buffer = fs.readFileSync(filePath);
    // 创建 PDF 解析实例，传入二进制数据
    const parser = new PDFParse({ data: buffer });
    // 异步调用解析器获取 PDF 文本内容
    const pdfRes = await parser.getText();
    // 提取解析结果中的纯文本字段
    const text = pdfRes.text;

    // 简单文本切块逻辑（替代 RecursiveCharacterTextSplitter）
    const chunkSize = 600;       // 每个文本块最大字符数为 600
    const chunkOverlap = 80;     // 文本块之间重叠字符数为 80，避免关键信息被截断
    const chunks: string[] = []; // 初始化文本块数组
    let start = 0; // 初始化起始位置索引
    // 循环切分文本，直到覆盖全部内容
    while (start < text.length) {
      // 计算当前块结束位置，取起始+块大小和文本总长度的较小值
      const end = Math.min(start + chunkSize, text.length);
      // 将切片后的文本块推入数组
      chunks.push(text.slice(start, end));
      // 更新起始位置为结束位置减去重叠量，确保相邻块有重叠
      start = end - chunkOverlap;
    }

    // 将文本块数组映射为 LangChain Document 对象数组，附带块索引元数据
    const docs = chunks.map((chunk, i) => new Document({ pageContent: chunk, metadata: { chunk: i } }));

    // 创建 Chroma 向量数据库客户端实例
    const client = new ChromaClient({
      host: this.configService.get('CHROMA_HOST') || 'localhost', // 从配置获取 Chroma 主机地址，默认 localhost
      port: this.configService.get('CHROMA_PORT') || 8000, // 从配置获取 Chroma 端口号，默认 8000
    });
    // 获取或创建指定名称的集合（Collection）
    const collection = await client.getOrCreateCollection({ name: collectionName });

    // 提取所有文档的文本内容数组
    const texts = docs.map(d => d.pageContent);
    // 检查嵌入模型是否可用，不可用则抛出异常
    if (!this.embeddings) throw new BadRequestException('当前模型不支持 embeddings');
    // 调用嵌入模型将所有文本块转换为向量数组
    const embeddings = await this.embeddings.embedDocuments(texts);

    // 将向量化后的文档添加到 Chroma 集合中
    await collection.add({
      ids: docs.map((_, i) => `doc_${Date.now()}_${i}`), // 为每个文档生成唯一 ID（时间戳+索引）
      embeddings,                                          // 向量数据数组
      documents: texts,                                    // 原始文本内容
      metadatas: docs.map(d => d.metadata),                // 每个文档的元数据数组
    });

    // 返回 true 表示上传和向量化成功
    return true;
  }

  // ====================== 4. RAG 基于文档问答 ======================

  // RAG 查询方法：基于向量检索知识库回答用户问题
  async ragQuery(question: string, collectionName = 'business_docs') {
    // 创建 Chroma 向量数据库客户端
    const client = new ChromaClient({
      host: this.configService.get('CHROMA_HOST') || 'localhost', // Chroma 主机地址
      port: this.configService.get('CHROMA_PORT') || 8000, // Chroma 端口号
    });
    // 获取或创建指定名称的集合
    const collection = await client.getOrCreateCollection({ name: collectionName });

    // 检查嵌入模型是否可用
    if (!this.embeddings) throw new BadRequestException('当前模型不支持 embeddings');
    // 将用户问题文本转换为查询向量
    const questionEmbedding = await this.embeddings.embedQuery(question);

    // 在 Chroma 集合中执行向量相似度查询
    const queryResult = await collection.query({
      queryEmbeddings: [questionEmbedding], // 查询用的向量数组
      nResults: 3,                          // 返回最相似的 3 个结果
      include: ['documents'],               // 结果中包含原始文档内容
    });

    // 提取查询结果中的文档数组，取第一个查询的结果
    const relevantDocs = queryResult.documents?.[0] || [];
    // 将相关文档用双换行符拼接为上下文字符串
    const context = relevantDocs.join('\n\n');

    // 构建包含参考上下文的提示词模板
    const prompt = `
基于下面参考内容回答问题，不知道就如实回答不知道，禁止编造内容：
【参考上下文】
${context}
【用户问题】
${question}
    `;

    // 调用单轮简单问答方法，传入构建好的提示词获取回复
    return this.simpleChat(prompt);
  }

  // ====================== 5. SSE 流式打字机输出（核心体验） ======================

  // SSE 流式聊天方法：返回流式数据供前端打字机效果展示
  async streamChat(question: string) {
    // 调用 LLM 的 stream 方法，传入系统消息和用户问题
    const stream = await this.llm.stream([
      new SystemMessage('回答简短精炼'), // 系统提示词：要求回答简洁
      new HumanMessage(question), // 用户问题
    ]);
    // 返回流式可迭代对象
    return stream;
  }

  // ====================== 6. 列出用户的会话 ======================

  // 列出用户所有会话方法：从 Redis 中扫描所有会话 Key
  async listSessions(userId: string) {
    // 获取 Redis 原生客户端实例
    const redisClient = this.redisService.getClient();
    // 扫描匹配当前用户会话模式的所有 Key（新格式）
    const newKeys = await redisClient.keys(`ai:session:${userId}:*`);
    // 扫描匹配旧格式的所有 Key（向后兼容）
    const oldKeys = await redisClient.keys('chat_history:*');
    // 合并新旧 Key 数组
    const keys = [...newKeys, ...oldKeys];
    // 初始化会话列表，包含 sessionId 和消息数量
    const sessions: Array<{ sessionId: string; messageCount: number }> = [];
    // 遍历所有 Key，逐条获取会话信息
    for (const key of keys) {
      // 从 Redis 获取 JSON 格式的会话历史数据
      const data = await this.redisService.getJson<Array<{ type: string; content: string }>>(key);
      // 根据 Key 格式提取 sessionId（旧格式直接替换前缀，新格式按冒号分割取后部分）
      const sessionId = key.startsWith('chat_history:')
        ? key.replace('chat_history:', '') // 旧格式：去掉 chat_history: 前缀
        : key.split(':').slice(3).join(':'); // 新格式：按冒号分割后取第 4 段及之后
      // 将会话信息推入列表，包含 sessionId 和消息条数
      sessions.push({
        sessionId, // 会话 ID
        messageCount: data?.length || 0, // 消息数量，无数据则为 0
      });
    }
    // 返回会话列表数组
    return sessions;
  }

  // ====================== 7. 删除单个会话 ======================

  // 删除指定会话方法：从 Redis 中删除对应 Key
  async deleteSession(userId: string, sessionId: string) {
    // 构建会话历史的 Redis Key
    const historyKey = this.getSessionHistoryKey(userId, sessionId);
    // 调用 Redis 服务的 del 方法删除该 Key
    await this.redisService.del(historyKey);
    // 返回 true 表示删除成功
    return true;
  }

  // ====================== 8. 清空当前用户所有会话 ======================

  // 清空用户所有会话方法：批量删除 Redis 中该用户的所有会话 Key
  async clearSessions(userId: string) {
    // 获取 Redis 原生客户端实例
    const redisClient = this.redisService.getClient();
    // 扫描匹配当前用户会话模式的所有 Key
    const keys = await redisClient.keys(`ai:session:${userId}:*`);
    // 判断是否存在匹配的 Key
    if (keys.length > 0) {
      // 批量删除所有匹配的 Key
      await redisClient.del(keys);
    }
    // 同时删除用户最近会话记录 Key
    await this.redisService.del(this.getLastSessionKey(userId));
    // 返回 true 表示清空成功
    return true;
  }

  // ====================== 9. SSE 流式输出（带历史上下文） ======================

  // 带历史上下文的 SSE 流式聊天方法：流式输出的同时保存完整回复到历史
  async streamChatWithHistory(question: string, sessionId: string, userId: string) {
    // 构建会话历史 Redis Key
    const historyKey = this.getSessionHistoryKey(userId, sessionId);
    // 从 Redis 获取历史消息数据
    const historyData = await this.redisService.getJson<Array<{ type: string; content: string }>>(historyKey);

    // 初始化消息数组，首先放入系统提示词
    const messages: Array<SystemMessage | HumanMessage | AIMessage> = [
      new SystemMessage('你是后端全栈工程师，回答简洁'), // 系统角色设定
    ];

    // 判断是否存在历史消息
    if (historyData) {
      // 遍历历史消息，按类型转换为对应消息对象
      for (const msg of historyData) {
        // 如果是人类消息类型，创建 HumanMessage 并推入数组
        if (msg.type === 'human') messages.push(new HumanMessage(msg.content));
        // 如果是 AI 消息类型，创建 AIMessage 并推入数组
        else if (msg.type === 'ai') messages.push(new AIMessage(msg.content));
      }
    }

    // 将当前用户问题追加到消息数组
    messages.push(new HumanMessage(question));

    // 调用 LLM 的 stream 方法获取流式输出
    const stream = await this.llm.stream(messages);

    // 初始化完整回复字符串，用于累积流式输出内容
    let fullResponse = '';
    // 保存当前实例引用（用于在异步生成器中访问 this）
    const self = this;
    // 定义异步生成器函数：包装原始流，在输出同时累积完整回复
    const savedStream = (async function* () {
      // 遍历流式输出的每个数据块
      for await (const chunk of stream) {
        // 提取文本内容，兼容 string 和 ContentBlock[] 两种格式
        const content = typeof chunk.content === 'string'
          ? chunk.content // 字符串类型直接使用
          : Array.isArray(chunk.content) // 数组类型需要过滤和拼接
            ? chunk.content
                .filter((b: any) => b.type === 'text' && typeof b.text === 'string') // 过滤出纯文本类型的块
                .map((b: any) => b.text) // 提取每个文本块的 text 字段
                .join('') // 拼接为完整字符串
            : ''; // 其他类型返回空字符串
        // 将提取的内容累积到完整回复字符串中
        fullResponse += content;
        // 产出（yield）原始数据块供前端消费
        yield chunk;
      }
      // 流式输出结束后执行以下逻辑
      // 判断是否获取到了有效回复内容
      if (fullResponse) {
        // 构建更新后的历史消息数组
        const updatedHistory = [
          ...(historyData || []), // 展开原有历史
          { type: 'human', content: question }, // 追加用户问题
          { type: 'ai', content: fullResponse }, // 追加完整 AI 回复
        ].slice(-20); // 只保留最近 20 条消息
        // 将更新后的历史存入 Redis，过期时间 24 小时
        await self.redisService.setJson(historyKey, updatedHistory, 86400);
        // 更新用户最近会话记录
        await self.recordLastSession(userId, sessionId);
      }
    })(); // 立即执行异步生成器函数

    // 返回包装后的流式生成器
    return savedStream;
  }

  // ====================== 10. 获取用户最近一次会话 ======================

  // 获取用户最近一次会话方法：从 Redis 获取并验证会话有效性
  async getLastSession(userId: string): Promise<{ sessionId: string } | null> {
    // 从 Redis 获取最近会话记录的 JSON 数据，包含 sessionId 和更新时间
    const lastData = await this.redisService.getJson<{ sessionId: string; updatedAt: number }>(
      this.getLastSessionKey(userId), // Redis Key
    );
    // 判断最近会话记录是否存在 sessionId，不存在则返回 null
    if (!lastData?.sessionId) return null;
    // 构建该会话的历史数据 Redis Key
    const historyKey = this.getSessionHistoryKey(userId, lastData.sessionId);
    // 检查历史数据 Key 在 Redis 中是否仍然存在（TTL 可能已过期）
    const exists = await this.redisService.exists(historyKey);
    // 如果历史数据已不存在
    if (!exists) {
      // 清理最近会话记录 Key
      await this.redisService.del(this.getLastSessionKey(userId));
      // 返回 null 表示无有效会话
      return null;
    }
    // 返回包含 sessionId 的对象
    return { sessionId: lastData.sessionId };
  }

  // ====================== 11. 获取指定会话的历史消息 ======================

  // 获取指定会话的历史消息方法：从 Redis 获取并转换为前端展示格式
  async getSessionMessages(userId: string, sessionId: string) {
    // 构建会话历史的 Redis Key
    const historyKey = this.getSessionHistoryKey(userId, sessionId);
    // 从 Redis 获取历史消息数据
    const historyData = await this.redisService.getJson<Array<{ type: string; content: string }>>(historyKey);
    // 如果没有历史数据，返回空数组
    if (!historyData || historyData.length === 0) return [];
    // 转换为前端展示格式，human -> user, ai -> assistant
    return historyData.map((msg) => ({
      role: msg.type === 'human' ? 'user' : 'assistant',
      content: msg.content,
    }));
  }
}
