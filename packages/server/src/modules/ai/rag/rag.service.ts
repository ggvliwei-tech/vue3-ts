/**
 * RAG 检索增强生成服务
 *
 * 从 AiService 抽出的 PDF 解析 + Chroma 向量库相关职责
 * 责任范围：
 *  - PDF 文件解析与文本切块
 *  - Chroma 向量库写入与相似度查询
 *  - 基于检索结果构造 Prompt
 *
 * 不感知：会话历史、Redis 缓存 —— 这些都由编排层协调
 *
 * ========== 两级知识库隔离 ==========
 * 向量库分两类 collection：
 *  - 公共库 PUBLIC_COLLECTION：由管理端（权限码 ai:doc:manage）维护，所有用户都能检索到
 *  - 私有库 user_docs_{userId}：每个用户一个，只有本人能读写
 * 检索时两个库各取 Top-K 再按距离合并，因此私有资料不会被公共库挤空，
 * 公共资料也不会被私有库遮住。
 *
 * ⚠️ 合并排序成立的前提：两个库用**同一个 embedding 模型、同一种距离度量**建库。
 *    Chroma 默认 L2，本项目所有 collection 都由 getOrCreateCollection 以默认参数建立。
 *    若将来切换 LLM_TYPE / embedding 模型，公共库里已有的向量与新查询向量维度不符，
 *    查询会直接报错（代码里对单库查询失败做了降级：记 warn 并跳过该库，不影响另一库）。
 */
import { Injectable, BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'
import { PDFParse } from 'pdf-parse'
import { ChromaClient, ChromaNotFoundError } from 'chromadb'
import type { Collection, Metadata, Where } from 'chromadb'
import {
  LlmProviderService,
  EmbeddingsUnavailableError,
} from '../llm/llm-provider.service'
import type { EmbeddingsClient } from '../llm/llm-provider.service'

/** PDF 切块参数：600 字符 / 80 重叠 */
const CHUNK_SIZE = 600
const CHUNK_OVERLAP = 80
/** 检索返回条数：**每个库各取这么多**，合并后再截断到同一个数 */
const TOP_K = 3
/** 公共知识库的 collection 名（历史沿用，避免已有数据迁移） */
const PUBLIC_COLLECTION = 'business_docs'
/** metadata 里 filename 的最大留存长度，防止超长文件名撑大元数据 */
const FILENAME_MAX_LENGTH = 200

/** 知识库作用域 */
export type RagScope = 'public' | 'private'

/** 写入向量库的入参 */
export interface IngestOptions {
  scope: RagScope
  /** scope 为 private 时必填 */
  userId?: number
  filename: string
}

/** 文档粒度摘要（由 chunk 级 metadata 聚合而来） */
export interface DocSummary {
  docId: string
  filename: string
  /** 该文档的切块数 */
  chunks: number
  uploadedAt: number
}

/** 一次操作的目标库 */
interface RagTarget {
  collectionName: string
  /** 公共库记为 0（写入 metadata 用） */
  userId: number
  scope: RagScope
}

/** 一条检索命中 */
interface Retrieved {
  text: string
  distance: number
  filename: string
  scope: RagScope
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name)
  private readonly chroma: ChromaClient

  constructor(
    private readonly configService: ConfigService,
    private readonly llmProvider: LlmProviderService,
  ) {
    this.chroma = new ChromaClient({
      host: this.configService.get('CHROMA_HOST') || 'localhost',
      port: this.configService.get('CHROMA_PORT') || 8000,
    })
    // 启动期兜一道：连不上 Chroma 别等接口 500，集中报错更易排错。
    // 上次踩的坑：CHROMA_PORT=8000 默认值命中宿主机的 LODOP 打印服务，
    // 每个 RAG 接口拿到 HTML 而报 `Cannot read properties of undefined
    // (reading 'embedding_function')` —— 错误的"形"是 chromadb 客户端
    // 内部字段访问，根因却是端到端连通性问题，延后到运行时才发现。
    //
    // 这里**故意不抛错**：chroma 不可用不该让整个 backend 起不来，
    // 其他接口（登录、上传、账本）跟 RAG 无关，应当照常服务；
    // 真正的接口级 500 由 listDocuments / buildPrompt 等路径在调用时兜。
    void this.chroma
      .version()
      .then((v) => this.logger.log(`Chroma 服务端连通正常（version=${v}）`))
      .catch((err: unknown) => {
        const host = this.configService.get('CHROMA_HOST') || 'localhost'
        const port = this.configService.get('CHROMA_PORT') || 8000
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(
          `Chroma 服务端连不上（${host}:${port}）— ${msg}\n` +
            `  · 宿主机 8000 被占用（LODOP/打印服务等）时，改 CHROMA_PORT 避开\n` +
            `  · backend 在 docker 容器里而 chroma 在宿主机：改用 host.docker.internal 或 docker compose 服务名（chroma）\n` +
            `  · chroma 镜像必须 ≥1.0（npm 客户端 3.5.0 走 /api/v2，老版 0.5.x 不兼容）`,
        )
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

  /**
   * 校验魔术字节并解析 PDF 文本。
   *
   * 直接吃内存里的 Buffer，不落盘：multer 在本项目里用的是默认的 memoryStorage
   * （全仓没有任何 MulterModule / diskStorage 配置），上传文件只有 buffer、
   * **没有 path 字段**。此前这里按磁盘路径读，导致 file.path === undefined →
   * existsSync(undefined) === false → 恒定抛「文件不存在」，该接口从未成功过。
   */
  private async readPdf(buffer: Buffer): Promise<string> {
    // 魔术字节校验：扩展名和 Content-Type 都是客户端说了算的，不能作为判据。
    // 与 file 模块的做法保持一致（file.service.ts 里也是校验魔术字节）。
    if (buffer.length < 5 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new BadRequestException('文件内容不是合法的 PDF')
    }
    const parser = new PDFParse({ data: buffer })
    const pdfRes = await parser.getText()
    return pdfRes.text
  }

  /**
   * 解析出这次操作要落到哪个库。
   *
   * 私有库的 collection 名必须经这里生成，**杜绝把任意字符串拼进 collection 名**。
   * 生成结果形如 user_docs_12，天然满足 Chroma 对 collection 名的约束
   * （3–63 字符、仅 [a-zA-Z0-9._-]、首尾字母数字、不得是 IP）。
   */
  private resolveTarget(scope: RagScope, userId?: number): RagTarget {
    if (scope === 'public') {
      return { collectionName: PUBLIC_COLLECTION, userId: 0, scope }
    }
    if (userId === undefined || !Number.isInteger(userId) || userId <= 0) {
      throw new BadRequestException('非法的用户标识')
    }
    return { collectionName: `user_docs_${userId}`, userId, scope }
  }

  /**
   * 取 embeddings，不可用时给出 **503** 而不是让它变成 500。
   *
   * LLM_TYPE=ollama 时 llm-provider 返回 embeddings: null（本地 Ollama 不提供
   * 兼容的 embedding 接口），RAG 的两条路径都会撞上。这是**配置问题、不是代码缺陷**，
   * 用 503 + 明确文案让运维一眼看出该换 provider，而不是去翻 500 堆栈。
   */
  private requireEmbeddings(): NonNullable<EmbeddingsClient> {
    try {
      return this.llmProvider.requireEmbeddings()
    } catch (err) {
      if (err instanceof EmbeddingsUnavailableError) {
        // 带上具体原因（缺哪个 key / 哪个 provider 不支持），否则运维只能看到
        // 一句笼统的「不可用」，还得回代码里猜是配置没生效还是模型选错了。
        throw new ServiceUnavailableException(
          `知识库功能不可用：${err.message}。请检查后端容器的 LLM 相关环境变量后重启`,
        )
      }
      throw err
    }
  }

  /** 判断 getCollection 的失败是否属于「collection 不存在」 */
  private isNotFound(err: unknown): boolean {
    if (err instanceof ChromaNotFoundError) return true
    // 兜一层：HTTP 404 经 apiClient 包装后不保证保留类身份
    const e = err as { status?: number; response?: { status?: number }; message?: string }
    const status = e?.status ?? e?.response?.status
    if (status === 404) return true
    return typeof e?.message === 'string' && /not found|does not exist/i.test(e.message)
  }

  /** 获取或创建 collection（写路径专用，保证幂等） */
  private async getCollection(name: string): Promise<Collection> {
    return this.chroma.getOrCreateCollection({ name })
  }

  /**
   * 仅在 collection 已存在时返回句柄，否则返回 null。
   *
   * 读路径一律走这里，不用 getOrCreate：一次检索 / 列文档 / 删除操作
   * 不该在向量库里凭空建出一堆空 collection（HNSW 索引是常驻内存的）。
   */
  private async getCollectionIfMissing(name: string): Promise<Collection | null> {
    try {
      return await this.chroma.getCollection({ name })
    } catch (err) {
      if (this.isNotFound(err)) return null
      throw err
    }
  }

  /** 从 metadata 里安全取字符串（Metadata 的值类型是联合类型，不能直接当 string 用） */
  private metaString(meta: Metadata | null, key: string, fallback: string): string {
    const v = meta?.[key]
    return typeof v === 'string' && v.length > 0 ? v.slice(0, FILENAME_MAX_LENGTH) : fallback
  }

  /** 从 metadata 里安全取数字 */
  private metaNumber(meta: Metadata | null, key: string, fallback: number): number {
    const v = meta?.[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }

  /**
   * 修复历史文件名乱码：multipart 文件名曾被 busboy 按 latin1 解码，
   * UTF-8 中文会变成 `æµ‹è¯•.pdf` 这类字符并写进 Chroma metadata。
   *
   * 只在字符串**全部**落在 latin1 范围（码点 ≤ 0xFF）时尝试反解：
   *  - 正确解码的中文名码点 > 0xFF，原样返回，不会被二次破坏；
   *  - 纯 ASCII 名反解前后一致；
   *  - 反解出现 U+FFFD（非法 UTF-8）说明它本来就是 latin1 文本，保持原值。
   *
   * 新上传已由 FileInterceptor 的 defParamCharset=utf8 从源头修正，
   * 这里只负责让历史数据在列表 / 检索 Prompt 里正常显示。
   */
  private repairLatin1Mojibake(value: string): string {
    if (!value) return value
    if ([...value].some((ch) => (ch.codePointAt(0) ?? 0) > 0xff)) return value
    const decoded = Buffer.from(value, 'latin1').toString('utf8')
    return decoded.includes('�') ? value : decoded
  }

  /**
   * 规范上传文件名：只取最后一段路径、去掉控制字符与格式字符、限制长度。
   * 文件名会进 metadata 并拼进 Prompt，不能原样信任客户端。
   *
   * 用 Unicode 属性转义（Cc = 控制字符，Cf = 格式字符）而不是 [\x00-\x1f] 这种
   * 转义区间：源码里不留裸控制字节，避免被工具链 / git 当成二进制文件。
   */
  private normalizeFilename(raw: string | undefined): string {
    const base = this.repairLatin1Mojibake((raw ?? '').split(/[\\/]/).pop() ?? '')
    const cleaned = base.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
    return cleaned.slice(0, FILENAME_MAX_LENGTH) || '未命名文档'
  }

  /**
   * 解析 PDF 并写入向量库
   * @param buffer PDF 文件内容（由 multer memoryStorage 提供）
   * @param opts 作用域 / 用户 / 文件名
   * @returns 本次写入的文档 ID 与切块数
   */
  async ingestPdf(buffer: Buffer, opts: IngestOptions): Promise<{ docId: string; chunks: number }> {
    // 先解析目标库：userId 非法要尽早报错，别白解析一遍 PDF
    const target = this.resolveTarget(opts.scope, opts.userId)

    const text = await this.readPdf(buffer)
    const chunks = this.splitText(text)
    // 扫描件 / 纯图片 PDF 提取不出文本。此前这里静默 return true，
    // 前端看到「上传成功」却检索不到任何东西 —— 改为明确报错。
    if (chunks.length === 0) {
      throw new BadRequestException('该 PDF 未提取到文本（可能是扫描件），无法建立索引')
    }

    const embeddings = this.requireEmbeddings()
    const vectors = await embeddings.embedDocuments(chunks)

    // 每次上传生成一次 docId：此前用 `doc_${Date.now()}_${i}`，
    // 同毫秒的并发上传会撞 id，而 Chroma 的 add 遇到重复 id 是**覆盖** ——
    // 两个用户同时上传会互相吃掉对方的切块。
    const docId = randomUUID()
    const uploadedAt = Date.now()
    const filename = this.normalizeFilename(opts.filename)

    const collection = await this.getCollection(target.collectionName)
    await collection.add({
      ids: chunks.map((_, i) => `${docId}#${i}`),
      embeddings: vectors,
      documents: chunks,
      metadatas: chunks.map((_, i) => ({
        docId,
        chunk: i,
        filename,
        userId: target.userId,
        source: target.scope,
        uploadedAt,
      })),
    })
    return { docId, chunks: chunks.length }
  }

  /**
   * 查单个 collection，失败降级为空结果。
   *
   * 不让单库失败打断整个提问：公共库若是历史上用别的 embedding 模型建的，
   * 维度不符会直接抛错，若向上传播就变成「切一次 provider，AI 对话全挂」。
   */
  private async queryCollection(target: RagTarget, questionVec: number[]): Promise<Retrieved[]> {
    const collection = await this.getCollectionIfMissing(target.collectionName)
    if (!collection) return []

    try {
      const result = await collection.query({
        queryEmbeddings: [questionVec],
        nResults: TOP_K,
        include: ['documents', 'distances', 'metadatas'],
      })
      const docs = result.documents?.[0] ?? []
      const distances = result.distances?.[0] ?? []
      const metadatas = result.metadatas?.[0] ?? []

      const hits: Retrieved[] = []
      for (let i = 0; i < docs.length; i++) {
        const text = docs[i]
        if (!text) continue
        hits.push({
          text,
          // 距离缺失时排到最后，而不是当成 0（0 会被误读成"最相似"）
          distance: distances[i] ?? Number.POSITIVE_INFINITY,
          // 历史文档的 filename 可能是 latin1 乱码，进 Prompt 前统一修复
          filename: this.repairLatin1Mojibake(
            this.metaString(metadatas[i] ?? null, 'filename', '未知文档'),
          ),
          scope: target.scope,
        })
      }
      return hits
    } catch (err) {
      this.logger.warn(
        `检索 collection「${target.collectionName}」失败，本次已跳过：${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      return []
    }
  }

  /**
   * 检索公共库 + 当前用户私有库，合并后组装 Prompt。
   * 业务侧只需要把返回的 prompt 喂给 LLM 即可。
   */
  async buildPrompt(question: string, userId: number): Promise<string> {
    const embeddings = this.requireEmbeddings()
    const questionVec = await embeddings.embedQuery(question)

    // 每个库各取 TOP_K，合并后再全局截断 —— 否则私有资料会被公共库挤空，
    // 两级隔离就只剩"能写不能读"了。
    const merged: Retrieved[] = [
      ...(await this.queryCollection(this.resolveTarget('public'), questionVec)),
      ...(await this.queryCollection(this.resolveTarget('private', userId), questionVec)),
    ]
    // Chroma 的 distance 越小越相似
    merged.sort((a, b) => a.distance - b.distance)
    const top = merged.slice(0, TOP_K)

    const context = top
      .map(
        (hit) =>
          `【${hit.scope === 'public' ? '公共资料' : '我的资料'}·${hit.filename}】\n${hit.text}`,
      )
      .join('\n\n')

    return `
基于下面参考内容回答问题，不知道就如实回答不知道，禁止编造内容：
【参考上下文】
${context}
【用户问题】
${question}
    `
  }

  /**
   * 列出某个库里的文档（文档粒度，不是切块粒度）。
   * 数据源是 Chroma 的 metadata，不额外建 MySQL 表 —— 文档的权威状态就在向量库里。
   */
  async listDocuments(opts: { scope: RagScope; userId?: number }): Promise<DocSummary[]> {
    const target = this.resolveTarget(opts.scope, opts.userId)
    const collection = await this.getCollectionIfMissing(target.collectionName)
    if (!collection) return []

    try {
      const result = await collection.get({ include: ['metadatas'] })
      const metadatas = result.metadatas ?? []

      // 按 docId 聚合成文档粒度：同一文档的多个切块只出一个列表项
      const byDocId = new Map<string, DocSummary>()
      for (const meta of metadatas) {
        const docId = this.metaString(meta, 'docId', '')
        if (!docId) continue
        const existing = byDocId.get(docId)
        if (existing) {
          existing.chunks += 1
          continue
        }
        byDocId.set(docId, {
          docId,
          // 修复旧版本按 latin1 解码留下的文件名乱码（新上传已是正确的 UTF-8）
          filename: this.repairLatin1Mojibake(
            this.metaString(meta, 'filename', '未知文档'),
          ),
          chunks: 1,
          uploadedAt: this.metaNumber(meta, 'uploadedAt', 0),
        })
      }
      return [...byDocId.values()].sort((a, b) => b.uploadedAt - a.uploadedAt)
    } catch (err) {
      this.logger.warn(
        `列出 collection「${target.collectionName}」文档失败：${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      return []
    }
  }

  /**
   * 删除一个文档的全部切块
   * @returns 实际删除的切块数
   */
  async deleteDocument(opts: {
    scope: RagScope
    userId?: number
    docId: string
  }): Promise<number> {
    const target = this.resolveTarget(opts.scope, opts.userId)
    const collection = await this.getCollectionIfMissing(target.collectionName)
    if (!collection) return 0

    // 分两步（先 get 出 ids 再 delete({ids})）而不是一次 delete({where})：
    // 部分 Chroma 版本对 where 过滤删除的支持不一致。
    // 私有库额外加 userId 条件：即便 docId 被猜到，也删不到别人的数据。
    const where: Where =
      target.scope === 'private'
        ? { $and: [{ docId: opts.docId }, { userId: target.userId }] }
        : { docId: opts.docId }

    const found = await collection.get({ where })
    const ids = found.ids ?? []
    if (ids.length === 0) return 0

    await collection.delete({ ids })
    return ids.length
  }
}
