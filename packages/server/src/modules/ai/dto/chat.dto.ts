// 导入校验装饰器：IsNotEmpty(非空)、IsOptional(可选)、IsString(字符串)、MaxLength(最大长度)
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 提问内容长度上限。
 *
 * 这个上限不只是"防脏数据"，它直接决定成本：question 会被拼进发给 LLM 的 prompt，
 * 按 token 计费。没有上限时，一次请求就能塞进上万个 token，而接口只有全局
 * 300 次/分钟的粗粒度限流 —— 单账号循环调用即可把第三方 API 账单打爆。
 * 4000 字符足够覆盖正常提问（含粘贴的长代码片段），同时把单次调用的输入成本封顶。
 */
export const MAX_QUESTION_LENGTH = 4000;

/**
 * 会话 ID 长度上限，与 nest-db.sql 里 `ai_session.session_id VARCHAR(36)` 对齐。
 *
 * 为什么必须卡住：sessionId 由客户端回传，超长时 MySQL 严格模式报 ER_DATA_TOO_LONG
 * → 500，而**此时付费的 LLM 调用已经完成、Redis 上下文也已按这个长 key 写入**；
 * 非严格模式更糟 —— 静默截断到 36 字符，两个不同的 sessionId 截断后相同即命中
 * 唯一键 uk_ai_session_user_session，两段无关的对话被并进同一会话。
 *
 * 不额外用 @IsUUID 卡格式：sessionId 由服务端 randomUUID() 生成、前端只做回传，
 * 格式校验一旦与生成方式脱节（比如将来换成雪花 ID）就会把老会话全部拒掉。
 * 真正会造成数据损坏的是长度，卡住长度即可。
 */
export const MAX_SESSION_ID_LENGTH = 36;

// 聊天请求 DTO 类，定义 AI 问答接口的请求数据结构
export class ChatDto {
  // 校验：提问内容非空、必须是字符串、不超长
  @IsNotEmpty({ message: '提问内容不能为空' })
  @IsString({ message: '提问内容必须是字符串' })
  @MaxLength(MAX_QUESTION_LENGTH, {
    message: `提问内容不能超过 ${MAX_QUESTION_LENGTH} 个字符`,
  })
  question: string; // 用户提问的内容字段

  // 可选字段装饰器：标记 sessionId 为可选字段，不传也不会校验失败
  @IsOptional()
  @IsString({ message: '会话 ID 必须是字符串' })
  @MaxLength(MAX_SESSION_ID_LENGTH, {
    message: `会话 ID 不能超过 ${MAX_SESSION_ID_LENGTH} 个字符`,
  })
  sessionId?: string; // 多轮对话的唯一会话 ID，用于关联上下文历史
}
