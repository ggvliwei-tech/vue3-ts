/**
 * AI 会话历史服务
 *
 * C4 拆分：从 AiService 抽出的会话 + 消息持久化职责
 * 责任范围：
 *  - Redis 缓存会话历史消息（用于多轮对话上下文）
 *  - MySQL session / message 持久化
 *  - 用户最近会话记录
 *
 * 不感知：LLM 调用、RAG 检索 —— 这些由 LlmProviderService / RagService 承担
 */
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, In } from 'typeorm'
import { AiSessionEntity } from '../entities/ai-session.entity'
import { AiMessageEntity } from '../entities/ai-message.entity'
import { RedisService } from '../../redis/redis.service'

/** 历史消息在 Redis 中的 TTL（秒）：24 小时 */
const HISTORY_TTL = 86_400
/** 最近会话指针在 Redis 中的 TTL（秒）：7 天 */
const LAST_SESSION_TTL = 604_800
/** 上下文保留的最大消息条数（10 轮 = 20 条） */
const MAX_HISTORY_ITEMS = 20

export interface HistoryMessage {
  type: 'human' | 'ai'
  content: string
}

@Injectable()
export class AiChatHistoryService {
  constructor(
    @InjectRepository(AiSessionEntity)
    private readonly sessionRepo: Repository<AiSessionEntity>,
    @InjectRepository(AiMessageEntity)
    private readonly messageRepo: Repository<AiMessageEntity>,
    private readonly redisService: RedisService,
  ) {}

  // ====================== Redis Key 工具 ======================

  private historyKey(userId: string, sessionId: string) {
    return `ai:session:${userId}:${sessionId}`
  }

  private lastSessionKey(userId: string) {
    return `ai:session:last:${userId}`
  }

  // ====================== Redis 历史读写 ======================

  async getHistory(userId: string, sessionId: string): Promise<HistoryMessage[]> {
    const data = await this.redisService.getJson<HistoryMessage[]>(
      this.historyKey(userId, sessionId),
    )
    return data || []
  }

  async appendHistory(
    userId: string,
    sessionId: string,
    question: string,
    answer: string,
    previous?: HistoryMessage[],
  ): Promise<void> {
    const merged = [
      ...(previous || []),
      { type: 'human', content: question },
      { type: 'ai', content: answer },
    ].slice(-MAX_HISTORY_ITEMS)
    await this.redisService.setJson(this.historyKey(userId, sessionId), merged, HISTORY_TTL)
  }

  async clearHistory(userId: string, sessionId: string): Promise<void> {
    await this.redisService.del(this.historyKey(userId, sessionId))
  }

  // ====================== 最近会话指针 ======================

  async setLastSession(userId: string, sessionId: string): Promise<void> {
    await this.redisService.setJson(
      this.lastSessionKey(userId),
      { sessionId, updatedAt: Date.now() },
      LAST_SESSION_TTL,
    )
  }

  // ====================== MySQL Session 维护 ======================

  /** upsert 会话记录，确保存在并更新 updatedAt */
  async touchSession(userId: string, sessionId: string): Promise<AiSessionEntity> {
    const userIdNum = parseInt(userId, 10)
    const now = Date.now()
    let session = await this.sessionRepo.findOne({ where: { sessionId, userId: userIdNum } })
    if (session) {
      session.updatedAt = now
      await this.sessionRepo.save(session)
      return session
    }
    session = this.sessionRepo.create({
      userId: userIdNum,
      sessionId,
      title: '新对话',
      createdAt: now,
      updatedAt: now,
    })
    await this.sessionRepo.save(session)
    return session
  }

  /** 写一条用户消息 + 一条助手消息 */
  async saveTurn(
    sessionRowId: number,
    userId: string,
    question: string,
    answer: string,
  ): Promise<void> {
    const userIdNum = parseInt(userId, 10)
    const now = Date.now()
    await this.messageRepo.save([
      this.messageRepo.create({
        sessionId: sessionRowId,
        userId: userIdNum,
        role: 'user',
        content: question,
        createdAt: now - 1,
      }),
      this.messageRepo.create({
        sessionId: sessionRowId,
        userId: userIdNum,
        role: 'assistant',
        content: answer,
        createdAt: now,
      }),
    ])
  }

  // ====================== 查询：列表 / 最近 / 消息 ======================

  /**
   * 列出用户的所有会话，附带消息计数
   * 性能优化：使用单条 GROUP BY 查询避免 N+1
   */
  async listSessions(userId: string): Promise<Array<{ sessionId: string; messageCount: number }>> {
    const userIdNum = parseInt(userId, 10)
    const rows = await this.sessionRepo
      .createQueryBuilder('s')
      .leftJoin(AiMessageEntity, 'm', 'm.sessionId = s.id')
      .where('s.userId = :userId', { userId: userIdNum })
      .select('s.sessionId', 'sessionId')
      .addSelect('COUNT(m.id)', 'messageCount')
      .groupBy('s.id')
      .orderBy('s.updatedAt', 'DESC')
      .getRawMany<{ sessionId: string; messageCount: string }>()

    return rows.map((r) => ({
      sessionId: r.sessionId,
      messageCount: Number(r.messageCount) || 0,
    }))
  }

  async getLastSession(userId: string): Promise<{ sessionId: string } | null> {
    const userIdNum = parseInt(userId, 10)
    const session = await this.sessionRepo.findOne({
      where: { userId: userIdNum },
      order: { updatedAt: 'DESC' },
    })
    return session ? { sessionId: session.sessionId } : null
  }

  /** 获取会话的历史消息（按时间升序，供前端展示） */
  async getMessages(userId: string, sessionId: string) {
    const userIdNum = parseInt(userId, 10)
    const session = await this.sessionRepo.findOne({ where: { sessionId, userId: userIdNum } })
    if (!session) return []
    const messages = await this.messageRepo.find({
      where: { sessionId: session.id },
      order: { createdAt: 'ASC' },
    })
    return messages.map((m) => ({ role: m.role, content: m.content }))
  }

  // ====================== 删除 ======================

  async deleteSession(userId: string, sessionId: string): Promise<boolean> {
    const userIdNum = parseInt(userId, 10)
    await this.clearHistory(userId, sessionId)
    const session = await this.sessionRepo.findOne({ where: { sessionId, userId: userIdNum } })
    if (!session) return false
    await this.messageRepo.delete({ sessionId: session.id })
    await this.sessionRepo.delete(session.id)
    return true
  }

  /** 清空用户所有会话（Redis + MySQL） */
  async clearAll(userId: string): Promise<void> {
    const userIdNum = parseInt(userId, 10)
    // Redis: 扫描并批量删除
    const redisClient = this.redisService.getClient()
    const keys = await redisClient.keys(`ai:session:${userId}:*`)
    if (keys.length > 0) {
      await redisClient.del(keys)
    }
    await this.redisService.del(this.lastSessionKey(userId))

    // MySQL: 一次性删除所有 session + 关联 message
    const sessions = await this.sessionRepo.find({ where: { userId: userIdNum } })
    if (sessions.length > 0) {
      const sessionIds = sessions.map((s) => s.id)
      await this.messageRepo.delete({ sessionId: In(sessionIds) })
      await this.sessionRepo.delete({ userId: userIdNum })
    }
  }
}
