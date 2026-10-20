/**
 * RagService 单元测试
 *
 * 锁住两级知识库隔离的核心契约：
 *  1. 私有库的 collection 名只能由 resolveTarget 生成，userId 非法必须拒绝
 *     （否则会拼出 user_docs_NaN 这类名字，把数据写到谁都找不到的地方）
 *  2. 检索**同时**打公共库与当前用户私有库，按距离升序合并后取 TOP_K
 *     —— 只查一个库等于隔离失效
 *  3. 读路径（query / list / delete）不能建 collection
 *     （getOrCreateCollection 一被调用，用户每问一次就多一个空库）
 *  4. 切块 id 必须全局唯一且归属同一个 docId
 *     （旧实现 doc_${Date.now()}_${i} 在同毫秒并发上传时会互相覆盖）
 *  5. 删除私有资料必须带 userId 条件，猜中别人的 docId 也删不掉
 *  6. 单库查询失败只跳过该库，不能让整个提问 500
 *  7. embeddings 不可用（LLM_TYPE=ollama）给 503 而不是 500
 */

import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { RagService } from './rag.service'
import { LlmProviderService, EmbeddingsUnavailableError } from '../llm/llm-provider.service'

/** 私有库的 collection 名形如 user_docs_{userId} */
const PUBLIC_COLLECTION = 'business_docs'
const USER_ID = 42
const PRIVATE_COLLECTION = `user_docs_${USER_ID}`

// ========== mock 句柄（必须用 mock 前缀，jest.mock 工厂提升后才能引用）==========
const mockAdd = jest.fn()
const mockQuery = jest.fn()
const mockGet = jest.fn()
const mockDelete = jest.fn()
/** 读路径的取库入口：resolve 一个已存在的 collection */
const mockGetCollection = jest.fn()
/** 写路径的取库入口：不在读路径里出现 */
const mockGetOrCreateCollection = jest.fn()
const mockEmbedDocuments = jest.fn()
const mockEmbedQuery = jest.fn()
const mockRequireEmbeddings = jest.fn()
const mockGetText = jest.fn()

jest.mock('chromadb', () => {
  class ChromaNotFoundError extends Error {
    constructor(message = 'Collection not found') {
      super(message)
      this.name = 'ChromaNotFoundError'
    }
  }
  return {
    ChromaNotFoundError,
    ChromaClient: jest.fn().mockImplementation(() => ({
      // 构造函数里有一次启动期连通性自检（this.chroma.version()），
      // mock 缺了它会直接在 new RagService(...) 处抛
      // `this.chroma.version is not a function`，整个用例集连初始化都过不去。
      version: jest.fn().mockResolvedValue('1.0.0'),
      getOrCreateCollection: (...args: unknown[]) => mockGetOrCreateCollection(...args),
      getCollection: (...args: unknown[]) => mockGetCollection(...args),
    })),
  }
})

jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: () => mockGetText(),
  })),
}))

/** 一份能通过魔术字节校验的假 PDF */
function pdfBuffer(): Buffer {
  return Buffer.from('%PDF-1.4\nfake body for unit test\n')
}

/** collection 句柄：所有被测路径最终都落到这几个方法上 */
function collectionHandle() {
  return { add: mockAdd, query: mockQuery, get: mockGet, delete: mockDelete }
}

/** 造一个 query 返回值（chromadb 的形状是「每个 query 一层数组」） */
function queryResult(rows: { text: string; distance: number; filename: string }[]) {
  return {
    documents: [rows.map((r) => r.text)],
    distances: [rows.map((r) => r.distance)],
    metadatas: [rows.map((r) => ({ filename: r.filename }))],
  }
}

describe('RagService', () => {
  let service: RagService

  const mockConfigService = { get: jest.fn() } as unknown as ConfigService
  const mockLlmProvider = {
    requireEmbeddings: mockRequireEmbeddings,
  } as unknown as LlmProviderService

  beforeEach(() => {
    jest.clearAllMocks()

    // 默认：两个库都存在，embedding 可用
    mockGetCollection.mockResolvedValue(collectionHandle())
    mockGetOrCreateCollection.mockResolvedValue(collectionHandle())
    mockRequireEmbeddings.mockReturnValue({
      embedDocuments: mockEmbedDocuments,
      embedQuery: mockEmbedQuery,
    })
    mockEmbedQuery.mockResolvedValue([0.1, 0.2, 0.3])
    mockGetText.mockResolvedValue({ text: 'x'.repeat(1400) })
    mockAdd.mockResolvedValue(undefined)
    mockDelete.mockResolvedValue(undefined)
    mockQuery.mockResolvedValue(queryResult([]))
    mockGet.mockResolvedValue({ ids: [], metadatas: [] })

    service = new RagService(mockConfigService, mockLlmProvider)
  })

  // ===================== 1. 作用域与 collection 命名 =====================

  describe('作用域解析', () => {
    it('私有上传缺少 userId 时抛 BadRequestException，不拼出 user_docs_undefined', async () => {
      await expect(
        service.ingestPdf(pdfBuffer(), { scope: 'private', filename: 'a.pdf' }),
      ).rejects.toThrow(BadRequestException)
      // 关键：不能有任何写库动作
      expect(mockGetOrCreateCollection).not.toHaveBeenCalled()
    })

    it.each([0, -1, 1.5, Number.NaN])('私有上传 userId=%p 非法时拒绝', async (bad) => {
      await expect(
        service.ingestPdf(pdfBuffer(), { scope: 'private', userId: bad, filename: 'a.pdf' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('私有资料写入 user_docs_{userId}，公共资料写入 business_docs', async () => {
      mockEmbedDocuments.mockResolvedValue([[0.1]])

      await service.ingestPdf(pdfBuffer(), {
        scope: 'private',
        userId: USER_ID,
        filename: 'mine.pdf',
      })
      expect(mockGetOrCreateCollection).toHaveBeenLastCalledWith({ name: PRIVATE_COLLECTION })

      await service.ingestPdf(pdfBuffer(), { scope: 'public', filename: 'pub.pdf' })
      expect(mockGetOrCreateCollection).toHaveBeenLastCalledWith({ name: PUBLIC_COLLECTION })
    })
  })

  // ===================== 2. 写入与 id 唯一性 =====================

  describe('ingestPdf', () => {
    it('切块 id 全局唯一、同属一个 docId，且 metadata 带上归属信息', async () => {
      mockGetText.mockResolvedValue({ text: 'a'.repeat(1300) })
      mockEmbedDocuments.mockImplementation((texts: string[]) => texts.map(() => [0.1]))

      const res = await service.ingestPdf(pdfBuffer(), {
        scope: 'private',
        userId: USER_ID,
        filename: 'mine.pdf',
      })

      const arg = mockAdd.mock.calls[0][0]
      const ids: string[] = arg.ids
      // 切块数 > 1，否则"唯一性"这条断言没有意义
      expect(res.chunks).toBeGreaterThan(1)
      expect(ids).toHaveLength(res.chunks)
      expect(new Set(ids).size).toBe(ids.length)

      // 每个 id 都是 `${docId}#${i}`
      ids.forEach((id, i) => {
        expect(id).toBe(`${res.docId}#${i}`)
      })

      // metadata：私有库要让人能按 userId 过滤 / 删除
      expect(arg.metadatas[0]).toMatchObject({
        docId: res.docId,
        chunk: 0,
        filename: 'mine.pdf',
        userId: USER_ID,
        source: 'private',
      })
      expect(arg.metadatas[0].uploadedAt).toEqual(expect.any(Number))
    })

    it('公共库写入的 userId 固定为 0（区分"公共"与"某个用户"）', async () => {
      mockEmbedDocuments.mockResolvedValue([[0.1]])
      await service.ingestPdf(pdfBuffer(), { scope: 'public', filename: 'pub.pdf' })

      expect(mockAdd.mock.calls[0][0].metadatas[0]).toMatchObject({
        userId: 0,
        source: 'public',
      })
    })

    it('两次上传产生不同的 docId（同毫秒并发不再互相覆盖）', async () => {
      mockEmbedDocuments.mockResolvedValue([[0.1]])
      const first = await service.ingestPdf(pdfBuffer(), { scope: 'public', filename: 'a.pdf' })
      const second = await service.ingestPdf(pdfBuffer(), { scope: 'public', filename: 'b.pdf' })
      expect(first.docId).not.toBe(second.docId)
    })

    it('文件名只取最后一段路径并去掉控制字符', async () => {
      mockEmbedDocuments.mockResolvedValue([[0.1]])
      await service.ingestPdf(pdfBuffer(), {
        scope: 'public',
        filename: '../../etc/pa\nsswd.pdf',
      })
      expect(mockAdd.mock.calls[0][0].metadatas[0].filename).toBe('passwd.pdf')
    })

    it('非 PDF 内容被魔术字节校验拦下', async () => {
      await expect(
        service.ingestPdf(Buffer.from('not a pdf at all'), {
          scope: 'public',
          filename: 'fake.pdf',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('提取不到文本时明确报错，而不是静默"成功"', async () => {
      mockGetText.mockResolvedValue({ text: '' })
      await expect(
        service.ingestPdf(pdfBuffer(), { scope: 'public', filename: 'scan.pdf' }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ===================== 3. 合并检索 =====================

  describe('buildPrompt', () => {
    it('同时打两个库，并按距离升序合并取 TOP_K', async () => {
      mockGetCollection.mockImplementation((args: { name: string }) =>
        Promise.resolve(args.name === PUBLIC_COLLECTION ? { ...collectionHandle(), tag: 'pub' } : { ...collectionHandle(), tag: 'priv' }),
      )
      // 本次断言在下面通过 mock.calls 取 nResults，这里不需要读入参
      mockQuery.mockImplementation((_args: { nResults: number }) => {
        // 每次调用都返回三条，距离交错，用来验证合并排序
        return Promise.resolve(
          queryResult([
            { text: 'chunk', distance: 0.5, filename: 'x.pdf' },
            { text: 'chunk', distance: 0.5, filename: 'x.pdf' },
            { text: 'chunk', distance: 0.5, filename: 'x.pdf' },
          ]),
        )
      })

      await service.buildPrompt('问题', USER_ID)

      // 两个库各查一次
      expect(mockGetCollection).toHaveBeenCalledWith({ name: PUBLIC_COLLECTION })
      expect(mockGetCollection).toHaveBeenCalledWith({ name: PRIVATE_COLLECTION })
      expect(mockQuery).toHaveBeenCalledTimes(2)
      // 每库都按 TOP_K 取，而不是把 TOP_K 拆开
      expect(mockQuery.mock.calls[0][0].nResults).toBe(3)
    })

    it('距离小的排在前面，最终截断到 TOP_K，且私有不被公共挤空', async () => {
      // 公共 3 条、私有 2 条，共 5 条候选；TOP_K=3 只能留 3 条
      const publicRows = [
        { text: '公共-远', distance: 0.9, filename: 'pub.pdf' },
        { text: '公共-近', distance: 0.1, filename: 'pub.pdf' },
        { text: '公共-次远', distance: 0.7, filename: 'pub.pdf' },
      ]
      const privateRows = [
        { text: '私有-中', distance: 0.4, filename: 'mine.pdf' },
        { text: '私有-最近', distance: 0.2, filename: 'mine.pdf' },
      ]
      mockGetCollection.mockImplementation((args: { name: string }) =>
        Promise.resolve({ ...collectionHandle(), tag: args.name }),
      )
      // 靠调用顺序对应 getCollection 的顺序：先公共后私有
      mockQuery
        .mockResolvedValueOnce(queryResult(publicRows))
        .mockResolvedValueOnce(queryResult(privateRows))

      const prompt = await service.buildPrompt('问题', USER_ID)

      // 入选的是 0.1 公共-近 → 0.2 私有-最近 → 0.4 私有-中
      expect(prompt).toContain('公共-近')
      expect(prompt).toContain('私有-最近')
      expect(prompt).toContain('私有-中')
      // 被截断掉的两条公共内容不能出现
      expect(prompt).not.toContain('公共-次远')
      expect(prompt).not.toContain('公共-远')

      // 顺序严格按距离升序
      const order = ['公共-近', '私有-最近', '私有-中'].map((t) => prompt.indexOf(t))
      expect(order[0]).toBeLessThan(order[1])
      expect(order[1]).toBeLessThan(order[2])

      // 私有资料没有被公共库挤空 —— 这正是「每库各取 TOP_K 再合并」的目的
      expect(prompt).toContain('【我的资料·mine.pdf】')
      // 来源标注必须区分开，否则模型无法判断资料是公共还是用户自己的
      expect(prompt).toContain('【公共资料·pub.pdf】')
      expect(prompt).toContain('问题')
    })

    it('私有库不存在时只返回公共结果，不报错', async () => {
      mockGetCollection.mockImplementation((args: { name: string }) =>
        args.name === PUBLIC_COLLECTION
          ? Promise.resolve(collectionHandle())
          : Promise.reject(new Error('Collection [user_docs_42] does not exist')),
      )
      mockQuery.mockResolvedValue(
        queryResult([{ text: '公共内容', distance: 0.2, filename: 'pub.pdf' }]),
      )

      const prompt = await service.buildPrompt('问题', USER_ID)
      expect(prompt).toContain('公共内容')
      // 只查了公共库
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })

    it('单库查询抛错只跳过该库，不影响另一库（切 provider 后不至于全挂）', async () => {
      mockQuery
        .mockRejectedValueOnce(new Error('Embedding dimension mismatch'))
        .mockResolvedValueOnce(
          queryResult([{ text: '私有内容', distance: 0.3, filename: 'mine.pdf' }]),
        )

      const prompt = await service.buildPrompt('问题', USER_ID)
      expect(prompt).toContain('私有内容')
      expect(prompt).toContain('【我的资料·mine.pdf】')
    })

    it('检索走只读入口，不会顺手建出空 collection', async () => {
      await service.buildPrompt('问题', USER_ID)
      expect(mockGetOrCreateCollection).not.toHaveBeenCalled()
    })
  })

  // ===================== 4. 文档列表 =====================

  describe('listDocuments', () => {
    it('把切块聚合成文档粒度，并按上传时间倒序', async () => {
      mockGet.mockResolvedValue({
        ids: ['a#0', 'a#1', 'b#0'],
        metadatas: [
          { docId: 'a', chunk: 0, filename: 'a.pdf', uploadedAt: 100 },
          { docId: 'a', chunk: 1, filename: 'a.pdf', uploadedAt: 100 },
          { docId: 'b', chunk: 0, filename: 'b.pdf', uploadedAt: 200 },
        ],
      })

      const docs = await service.listDocuments({ scope: 'public' })

      expect(docs).toHaveLength(2)
      expect(docs[0]).toEqual({ docId: 'b', filename: 'b.pdf', chunks: 1, uploadedAt: 200 })
      expect(docs[1]).toEqual({ docId: 'a', filename: 'a.pdf', chunks: 2, uploadedAt: 100 })
    })

    it('修复历史文件名乱码，且不误伤已正确解码的中文名', async () => {
      // '测试.pdf' 的 UTF-8 字节被按 latin1 解码后的形态（旧版 busboy 的产物）
      const mojibake = Buffer.from('测试.pdf', 'utf8').toString('latin1')
      mockGet.mockResolvedValue({
        ids: ['old#0', 'new#0'],
        metadatas: [
          { docId: 'old', chunk: 0, filename: mojibake, uploadedAt: 100 },
          { docId: 'new', chunk: 0, filename: '测试.pdf', uploadedAt: 200 },
        ],
      })

      const docs = await service.listDocuments({ scope: 'public' })

      // 两条都必须显示为正常中文：老的靠读时反解，新的本来就是对的
      expect(docs.map((d) => d.filename)).toEqual(['测试.pdf', '测试.pdf'])
    })

    it('库不存在时返回空数组', async () => {
      mockGetCollection.mockRejectedValue(new Error('Collection not found'))
      await expect(service.listDocuments({ scope: 'public' })).resolves.toEqual([])
    })

    it('读路径同样不建 collection', async () => {
      await service.listDocuments({ scope: 'private', userId: USER_ID })
      expect(mockGetCollection).toHaveBeenCalledWith({ name: PRIVATE_COLLECTION })
      expect(mockGetOrCreateCollection).not.toHaveBeenCalled()
    })
  })

  // ===================== 5. 删除 =====================

  describe('deleteDocument', () => {
    it('私有删除带 userId 条件（猜中他人 docId 也删不掉）', async () => {
      mockGet.mockResolvedValue({ ids: ['d#0', 'd#1'], metadatas: [] })

      const removed = await service.deleteDocument({
        scope: 'private',
        userId: USER_ID,
        docId: 'd',
      })

      expect(mockGet).toHaveBeenCalledWith({
        where: { $and: [{ docId: 'd' }, { userId: USER_ID }] },
      })
      expect(mockDelete).toHaveBeenCalledWith({ ids: ['d#0', 'd#1'] })
      expect(removed).toBe(2)
    })

    it('公共删除只按 docId 过滤', async () => {
      mockGet.mockResolvedValue({ ids: ['d#0'], metadatas: [] })
      await service.deleteDocument({ scope: 'public', docId: 'd' })
      expect(mockGet).toHaveBeenCalledWith({ where: { docId: 'd' } })
    })

    it('没有命中任何切块时不调用 delete', async () => {
      mockGet.mockResolvedValue({ ids: [], metadatas: [] })
      const removed = await service.deleteDocument({ scope: 'public', docId: 'nope' })
      expect(mockDelete).not.toHaveBeenCalled()
      expect(removed).toBe(0)
    })
  })

  // ===================== 6. embeddings 不可用 =====================

  describe('embeddings 不可用', () => {
    beforeEach(() => {
      mockRequireEmbeddings.mockImplementation(() => {
        throw new EmbeddingsUnavailableError()
      })
    })

    it('上传给 503（配置问题）而不是 500', async () => {
      await expect(
        service.ingestPdf(pdfBuffer(), { scope: 'public', filename: 'a.pdf' }),
      ).rejects.toThrow(ServiceUnavailableException)
    })

    it('检索给 503 而不是 500', async () => {
      await expect(service.buildPrompt('问题', USER_ID)).rejects.toThrow(
        ServiceUnavailableException,
      )
    })
  })
})
