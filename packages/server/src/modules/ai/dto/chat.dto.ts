// 导入非空校验装饰器，用于验证字段不能为空
import { IsNotEmpty, IsOptional } from 'class-validator';
// 导入可选字段校验装饰器，用于标记字段为可选

// 聊天请求 DTO 类，定义 AI 问答接口的请求数据结构
export class ChatDto {
  // 校验：提问内容不能为空，违反时返回指定错误消息
  @IsNotEmpty({ message: '提问内容不能为空' })
  question: string; // 用户提问的内容字段

  // 可选字段装饰器：标记 sessionId 为可选字段，不传也不会校验失败
  @IsOptional()
  sessionId?: string; // 多轮对话的唯一会话 ID，用于关联上下文历史
}
