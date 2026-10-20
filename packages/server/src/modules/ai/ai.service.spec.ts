/**
 * AiService 聊天流程 × 知识库检索的集成契约
 *
 * 锁住一个曾经真实存在的缺陷：聊天框走的是 stream/history →
 * streamChatWithHistory，这条路径此前**从未调用 RagService**，
 * 用户上传的 PDF 只在向量库里躺着，AI 完全不知道内容。
 *
 * 这里不测 LLM 本身，只断言：
 *  1. 聊天前确实用当前 userId 检索了知识库，检索结果进了系统提示词
 *  2. 检索不可用时普通聊天照常进行（降级为空上下文）
 *  3. userId 非数字时跳过检索而不是让聊天报错
 */

import { AiService } from './ai.service'
import type { LlmProviderService } from './llm/llm-provider.service'
import type { RagService } from './rag/rag.service'
import type { AiChatHistoryService } from './chat-history/ai-chat-history.service'

describe('AiService 聊天中的知识库检索', () => {
  const mockLlm = {
    invoke: jest.fn(),
    stream: jest.fn(),
    invokeWithMessages: jest.fn(),
    streamWithMessages: jest.fn(),
  }
  const mockRag = {
    tryBuildContext: jest.fn(),
  }
  const mockHistory = {
    getHistory: jest.fn(),
    appendHistory: jest.fn(),
    touchSession: jest.fn(),
    saveTurn: jest.fn(),
    setLastSession: jest.fn(),
  }

  let service: AiService

  beforeEach(() => {
    jest.clearAllMocks()
    mockHistory.getHistory.mockResolvedValue([])
    mockHistory.appendHistory.mockResolvedValue(undefined)
    mockHistory.touchSession.mockResolvedValue({ id: 'db-session' })
    mockHistory.saveTurn.mockResolvedValue(undefined)
    mockHistory.setLastSession.mockResolvedValue(undefined)

    // 默认假装流式返回一个 chunk
    mockLlm.streamWithMessages.mockImplementation(() =>
      (async function* () {
        yield { content: '回答' }
      })(),
    )
    mockLlm.invokeWithMessages.mockResolvedValue({ content: '答案' })

    service = new AiService(
      mockLlm as unknown as LlmProviderService,
      mockRag as unknown as RagService,
      mockHistory as unknown as AiChatHistoryService,
    )
  })

  /** 把异步生成器读完，触发 finally 里的持久化 */
  async function drain(stream: AsyncIterable<unknown>): Promise<unknown[]> {
    const chunks: unknown[] = []
    for await (const chunk of stream) chunks.push(chunk)
    return chunks
  }

  it('流式聊天会检索公共库 + 私有库，并把命中的 PDF 内容放进系统提示词', async () => {
    mockRag.tryBuildContext.mockResolvedValue('【我的资料·方案.pdf】\nPDF 里的关键内容')

    const stream = await service.streamChatWithHistory('方案里怎么配置菜单？', 's1', '2')
    await drain(stream)

    // 用 JWT 里的 userId 定位私有库
    expect(mockRag.tryBuildContext).toHaveBeenCalledWith('方案里怎么配置菜单？', 2)

    const messages = mockLlm.streamWithMessages.mock.calls[0][0]
    expect(messages[0].content).toContain('PDF 里的关键内容')
    expect(messages[0].content).toContain('【我的资料·方案.pdf】')
    // 用户问题仍然在最后一条
    expect(messages[messages.length - 1].content).toBe('方案里怎么配置菜单？')
    // 正常落库
    expect(mockHistory.appendHistory).toHaveBeenCalled()
  })

  it('检索降级为空上下文时，聊天照常走默认提示词', async () => {
    mockRag.tryBuildContext.mockResolvedValue('')

    const stream = await service.streamChatWithHistory('你好', 's1', '2')
    await drain(stream)

    const messages = mockLlm.streamWithMessages.mock.calls[0][0]
    expect(messages[0].content).not.toContain('参考资料')
    expect(mockLlm.streamWithMessages).toHaveBeenCalled()
  })

  it('userId 不是正整数时跳过检索，而不是抛 400 让聊天失败', async () => {
    const stream = await service.streamChatWithHistory('你好', 's1', 'not-a-number')
    await drain(stream)

    expect(mockRag.tryBuildContext).not.toHaveBeenCalled()
    expect(mockLlm.streamWithMessages).toHaveBeenCalled()
  })

  it('同步多轮对话同样带知识库上下文', async () => {
    mockRag.tryBuildContext.mockResolvedValue('【公共资料·规范.pdf】\n接口规范')

    await service.chatWithHistory('接口规范是什么？', 's1', '2')

    const messages = mockLlm.invokeWithMessages.mock.calls[0][0]
    expect(messages[0].content).toContain('接口规范')
    expect(messages[messages.length - 1].content).toBe('接口规范是什么？')
  })
})
