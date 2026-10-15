/**
 * AI 会话历史服务
 *
 * 从 AiService 抽出的会话 + 消息持久化职责
 * 责任范围：
 *  - Redis 缓存会话历史消息（用于多轮对话上下文）
 *  - MySQL session / message 持久化
 *  - 用户最近会话记录
 *
 * 不感知：LLM 调用、RAG 检索 —— 这些由 LlmProviderService / RagService 承担
 */
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, In, QueryFailedError } from 'typeorm'
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

  /**
   * 追加一轮问答到 Redis 历史。
   *
   * 刻意不接收调用方持有的 history 快照，而是写入前现读一次：
   * 调用方那份快照通常取自 LLM 调用之前，而流式输出可能持续几十秒。
   * 期间同一会话若又完成了一轮（另一个标签页 / 用户重发），
   * 拿旧快照拼接再整体覆盖写回，会把中间那一轮直接抹掉。
   * 现读现写把竞态窗口从"整个 LLM 时长"压缩到"读与写之间"。
   */
  async appendHistory(
    userId: string,
    sessionId: string,
    question: string,
    answer: string,
  ): Promise<void> {
    const current = await this.getHistory(userId, sessionId)
    const merged = [
      ...current,
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
    const existing = await this.sessionRepo.findOne({
      where: { sessionId, userId: userIdNum },
    })
    if (existing) {
      existing.updatedAt = now
      await this.sessionRepo.save(existing)
      return existing
    }

    // 插入竞争：ai_session 上有唯一键 uk_ai_session_user_session(session_id, user_id)。
    // 前端在同一个新会话里快速连发两条消息（或用户刷新页面重发）时，
    // 两个请求会同时走到这里、同时 executeInsert，后到的那个撞唯一键抛
    // ER_DUP_ENTRY(1062)。这不是真实错误 —— 语义上"别人已经建好了，我用他的就行"，
    // 直接冒泡会变成 500，用户看到的是"AI 服务异常"，而数据其实完全正常。
    // 捕获 1062 后回读并更新即可。
    // （注意不能靠 find-then-save 的原子性来避免：TypeORM 的 save 对新建实体
    //   发的是 INSERT，不是 upsert，没有任何"存在则跳过"的语义。）
    try {
      return await this.sessionRepo.save(
        this.sessionRepo.create({
          userId: userIdNum,
          sessionId,
          title: '新对话',
          createdAt: now,
          updatedAt: now,
        }),
      )
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as any).driverError?.errno === 1062
      ) {
        const raced = await this.sessionRepo.findOne({
          where: { sessionId, userId: userIdNum },
        })
        if (raced) {
          raced.updatedAt = now
          await this.sessionRepo.save(raced)
          return raced
        }
      }
      throw err
    }
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
    // Redis：用 SCAN 游标逐批删除，**不要**用 KEYS。
    // KEYS 是 O(N) 全库遍历，且 Redis 命令执行是单线程的 —— 在有几万 key 的
    // 实例上它会阻塞所有其他命令（包括登录态的读写）直到遍历完。
    // 这是用户点一下「清空对话」就能触发的操作，代价却是全站卡顿。
    // scanStream 边扫边删：内存占用有界，单次 DEL 的参数个数也有界。
    const redisClient = this.redisService.getClient()
    const stream = redisClient.scanStream({
      match: `ai:session:${userId}:*`,
      count: 100,
    })
    for await (const batch of stream) {
      const keys = batch as string[]
      if (keys.length > 0) {
        await redisClient.del(...keys)
      }
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
