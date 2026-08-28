/**
 * RAG 检索增强生成服务
 *
 * C4 拆分：从 AiService 抽出的 PDF 解析 + Chroma 向量库相关职责
 * 责任范围：
 *  - PDF 文件解析与文本切块
 *  - Chroma 向量库写入与相似度查询
 *  - 基于检索结果构造 Prompt
 *
 * 不感知：会话历史、用户维度、Redis 缓存 —— 这些都由编排层协调
 */
import { Injectable, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import fs from 'fs'
import { Document } from '@langchain/core/documents'
import { PDFParse } from 'pdf-parse'
import { ChromaClient } from 'chromadb'
import { LlmProviderService } from '../llm/llm-provider.service'

/** 默认 PDF 切块参数：600 字符 / 80 重叠 */
const CHUNK_SIZE = 600
const CHUNK_OVERLAP = 80
/** 默认检索返回条数 */
const TOP_K = 3
/** 默认 collection 名 */
const DEFAULT_COLLECTION = 'business_docs'

@Injectable()
export class RagService {
  private readonly chroma: ChromaClient

  constructor(
    private readonly configService: ConfigService,
    private readonly llmProvider: LlmProviderService,
  ) {
    this.chroma = new ChromaClient({
      host: this.configService.get('CHROMA_HOST') || 'localhost',
      port: this.configService.get('CHROMA_PORT') || 8000,
    })
  }

  /**
   * 简易文本切块：以固定窗口滑动切分，相邻块保留重叠
   * 替代 RecursiveCharacterTextSplitter，避免引入额外依赖
   */
  private splitText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
    const chunks: string[] = []
    let start = 0
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length)
      chunks.push(text.slice(start, end))
      // 防止 overlap >= chunkSize 时无限循环
      const next = end - overlap
      start = next > start ? next : end
    }
    return chunks
  }

  /** 读取并解析 PDF 全文 */
  private async readPdf(filePath: string): Promise<string> {
    if (!fs.existsSync(filePath)) {
      throw new BadRequestException('文件不存在')
    }
    const buffer = fs.readFileSync(filePath)
    const parser = new PDFParse({ data: buffer })
    const pdfRes = await parser.getText()
    return pdfRes.text
  }

  /** 获取或创建 collection（保证幂等） */
  private async getCollection(name: string) {
    return this.chroma.getOrCreateCollection({ name })
  }

  /**
   * 解析 PDF 并写入向量库
   * @param filePath PDF 磁盘路径
   * @param collectionName collection 名
   */
  async ingestPdf(filePath: string, collectionName = DEFAULT_COLLECTION): Promise<true> {
    const text = await this.readPdf(filePath)
    const chunks = this.splitText(text)
    if (chunks.length === 0) return true

    const docs = chunks.map((chunk, i) =>
      new Document({ pageContent: chunk, metadata: { chunk: i } }),
    )
    const texts = docs.map((d) => d.pageContent)

    const embeddings = this.llmProvider.requireEmbeddings()
    const vectors = await embeddings.embedDocuments(texts)

    const collection = await this.getCollection(collectionName)
    await collection.add({
      ids: docs.map((_, i) => `doc_${Date.now()}_${i}`),
      embeddings: vectors,
      documents: texts,
      metadatas: docs.map((d) => d.metadata),
    })
    return true
  }

  /**
   * 检索 Top-K 文档，并组装 Prompt
   * 业务侧只需要把返回的 prompt 喂给 LLM 即可
   */
  async buildPrompt(question: string, collectionName = DEFAULT_COLLECTION): Promise<string> {
    const collection = await this.getCollection(collectionName)
    const embeddings = this.llmProvider.requireEmbeddings()

    const questionVec = await embeddings.embedQuery(question)
    const result = await collection.query({
      queryEmbeddings: [questionVec],
      nResults: TOP_K,
      include: ['documents'],
    })
    const docs = result.documents?.[0] || []
    const context = docs.join('\n\n')

    return `
基于下面参考内容回答问题，不知道就如实回答不知道，禁止编造内容：
【参考上下文】
${context}
【用户问题】
${question}
    `
  }
}
