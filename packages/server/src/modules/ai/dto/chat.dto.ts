// 导入非空校验和可选字段校验装饰器
import { IsNotEmpty, IsOptional } from 'class-validator';

// 聊天请求 DTO，定义 AI 问答接口的请求数据结构
export class ChatDto {
  // 校验：提问内容不能为空
  @IsNotEmpty({ message: '提问内容不能为空' })
  question: string; // 用户提问的内容

  // 可选字段：多轮对话的唯一会话 ID，用于关联上下文
  @IsOptional()
  sessionId?: string;
}
