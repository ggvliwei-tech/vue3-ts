// 导入 NestJS 核心装饰器：Controller(控制器)、Post(POST 路由)、Body(请求体解析)、Sse(服务端事件)、MessageEvent(SSE 消息类型)、Get(GET 路由)、Query(查询参数)、UseGuards(守卫)、Param(路由参数)、UseInterceptors(拦截器)、UploadedFile(上传文件)
import { Controller, Post, Body, Sse, MessageEvent, Get, Query, UseGuards, Param, UseInterceptors, UploadedFile } from '@nestjs/common';
// 导入 RxJS 可观察对象及相关操作符，用于流式数据处理管道
import { Observable, from, map, filter } from 'rxjs';
// 导入 AI 服务类，注入业务逻辑层
import { AiService } from './ai.service';
// 导入聊天 DTO 类，定义请求数据结构和校验规则
import { ChatDto } from './dto/chat.dto';
// 导入 LangChain 基础消息类型校验函数，用于判断消息格式
import { isBaseMessage } from '@langchain/core/messages';
// 导入 Node.js 原生 UUID 生成函数
import { randomUUID } from 'crypto';
// 导入 JWT 认证守卫，验证用户登录态
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
// 导入 Swagger 文档装饰器：ApiBearerAuth(Bearer Token 认证)、ApiOperation(接口描述)、ApiConsumes(请求内容类型)
import { ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
// 导入文件上传拦截器，处理 multipart/form-data 请求
import { FileInterceptor } from '@nestjs/platform-express';
// 导入限流守卫，控制接口请求频率
import { ThrottlerGuard } from '@nestjs/throttler';
// 导入当前用户装饰器，从请求中提取用户信息
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// 控制器级别守卫装饰器：所有接口均需 JWT 认证 + 限流保护
@UseGuards(JwtAuthGuard, ThrottlerGuard)
// Swagger 装饰器：在文档中显示 Bearer Token 输入框
@ApiBearerAuth()
// 控制器装饰器：设置 /ai 为所有路由的公共前缀
@Controller('ai')
// AI 控制器类：处理所有 AI 相关的 HTTP 请求
export class AiController {
  // 构造函数注入 AI 服务，NestJS 自动解析依赖
  constructor(private readonly aiService: AiService) {}

  // POST 路由装饰器：注册 /ai/chat 接口
  @Post('chat')
  // 简单单轮问答接口处理函数，接收请求体参数
  async chat(@Body() dto: ChatDto) {
    // 调用服务层简单问答方法，传入用户问题
    const data = await this.aiService.simpleChat(dto.question);
    // 返回统一响应格式（code: 0 表示成功，与 TransformInterceptor 保持一致）
    return { code: 0, data };
  }

  // POST 路由装饰器：注册 /ai/chat/history 接口
  @Post('chat/history')
  // 带会话历史的多轮对话接口，接收请求体和当前用户信息
  async chatHistory(@Body() dto: ChatDto, @CurrentUser() user: { id: string; username: string }) {
    // 如果未传 sessionId 则自动生成一个新的 UUID
    const sessionId = dto.sessionId || randomUUID();
    // 调用服务层带历史上下文的问答方法
    const data = await this.aiService.chatWithHistory(dto.question, sessionId, user.id);
    // 返回统一响应格式，包含 sessionId 用于前端关联（code: 0 表示成功）
    return { code: 0, data, sessionId };
  }

  // POST 路由装饰器：注册 /ai/rag 接口
  @Post('rag')
  // RAG 知识库问答接口处理函数
  async ragChat(@Body() dto: ChatDto) {
    // 调用服务层 RAG 问答方法，基于向量检索回答
    const data = await this.aiService.ragQuery(dto.question);
    // 返回统一响应格式（code: 0 表示成功）
    return { code: 0, data };
  }

  // GET 路由装饰器：注册 /ai/stream 接口
  @Get('stream')
  // SSE 装饰器：标识该接口为 Server-Sent Events 流式输出
  @Sse()
  // 流式输出接口处理函数，接收查询参数问题，返回可观察的 SSE 消息流
  async stream(@Query('question') question: string): Promise<Observable<MessageEvent>> {
    // 调用服务层流式聊天方法，获取原始流
    const stream = await this.aiService.streamChat(question);
    // 将流数据通过 from 转换为 Observable，使用 pipe 管道处理
    return from(stream).pipe(
      // map 操作符：将每个 chunk 转换为 SSE MessageEvent 格式
      map((chunk) => {
        // 定义文本提取函数，兼容 string 和 ContentBlock[] 两种格式
        const extractText = (c: any): string =>
          // 如果是字符串类型直接返回
          typeof c === 'string' ? c
            // 如果是数组，过滤出文本类型并拼接
            : Array.isArray(c)
              ? c.filter((b: any) => b.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('')
              // 其他类型返回空字符串
              : '';
        // 判断是否为 LangChain 基础消息，是则提取内容，否则转为字符串
        const content = isBaseMessage(chunk)
          ? extractText(chunk.content) // 从消息对象中提取纯文本
          : String(chunk); // 直接转为字符串
        // 返回符合 SSE 规范的消息事件对象
        return { data: content };
      }),
      // filter 操作符：过滤掉空数据的消息事件
      filter((event) => !!event.data),
    );
  }

  // POST 路由装饰器：注册 /ai/session/create 接口
  @Post('session/create')
  // Swagger 操作描述：创建新会话
  @ApiOperation({ summary: '创建新会话' })
  // 创建新会话接口处理函数
  async createSession(@CurrentUser() user: { id: string; username: string }) {
    // 生成新的 UUID 作为会话 ID
    const sessionId = randomUUID();
    // 记录用户最近使用的会话 ID 到 Redis
    await this.aiService.recordLastSession(user.id, sessionId);
    // 返回统一响应格式，包含新创建的 sessionId（code: 0 表示成功）
    return { code: 0, data: { sessionId } };
  }

  // GET 路由装饰器：注册 /ai/session/last 接口
  @Get('session/last')
  // Swagger 操作描述：获取用户最近一次会话
  @ApiOperation({ summary: '获取用户最近一次会话' })
  // 获取最近会话接口处理函数
  async getLastSession(@CurrentUser() user: { id: string; username: string }) {
    // 调用服务层获取用户最近一次会话的方法
    const lastSession = await this.aiService.getLastSession(user.id);
    // 返回统一响应格式
    return { code: 0, data: lastSession };
  }

  // POST 路由装饰器：注册 /ai/upload/pdf 接口
  @Post('upload/pdf')
  // Swagger 操作描述：上传 PDF 到 RAG 向量库
  @ApiOperation({ summary: '上传 PDF 到 RAG 向量库' })
  // Swagger 声明该接口消费 multipart/form-data 类型
  @ApiConsumes('multipart/form-data')
  // 使用文件上传拦截器，限制文件大小为 20MB
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  // PDF 上传接口处理函数，接收上传的文件
  async uploadPdf(@UploadedFile() file: Express.Multer.File) {
    // 调用服务层将 PDF 解析并存入向量库的方法
    const result = await this.aiService.uploadPdfToVector(file.path);
    // 返回统一响应格式，包含处理结果
    return { code: 0, data: result };
  }

  // GET 路由装饰器：注册 /ai/sessions 接口
  @Get('sessions')
  // Swagger 操作描述：列出用户的所有会话
  @ApiOperation({ summary: '列出用户的会话' })
  // 列出用户会话接口处理函数
  async listSessions(@CurrentUser() user: { id: string; username: string }) {
    // 调用服务层获取用户所有会话列表的方法
    const sessions = await this.aiService.listSessions(user.id);
    // 返回统一响应格式
    return { code: 0, data: sessions };
  }

  // POST 路由装饰器：注册 /ai/session/:sessionId/delete 接口
  @Post('session/:sessionId/delete')
  // Swagger 操作描述：删除单个会话
  @ApiOperation({ summary: '删除单个会话' })
  // 删除会话接口处理函数，接收路由参数中的 sessionId 和当前用户
  async deleteSession(@Param('sessionId') sessionId: string, @CurrentUser() user: { id: string; username: string }) {
    // 调用服务层删除指定会话的方法
    await this.aiService.deleteSession(user.id, sessionId);
    // 返回统一响应格式，包含操作提示消息
    return { code: 0, msg: '会话已删除' };
  }

  // POST 路由装饰器：注册 /ai/sessions/clear 接口
  @Post('sessions/clear')
  // Swagger 操作描述：清空当前用户所有会话历史
  @ApiOperation({ summary: '清空当前用户所有会话历史' })
  // 清空所有会话接口处理函数
  async clearSessions(@CurrentUser() user: { id: string; username: string }) {
    // 调用服务层清空用户所有会话的方法
    await this.aiService.clearSessions(user.id);
    // 返回统一响应格式，包含操作提示消息
    return { code: 0, msg: '所有会话已清空' };
  }

  // GET 路由装饰器：注册 /ai/stream/history 接口
  @Get('stream/history')
  // SSE 装饰器：标识该接口为 Server-Sent Events 流式输出
  @Sse()
  // Swagger 操作描述：SSE 流式输出（带历史上下文）
  @ApiOperation({ summary: 'SSE 流式输出（带历史上下文）' })
  // 带历史的流式输出接口，接收问题、sessionId 和当前用户
  async streamWithHistory(
    @Query('question') question: string, // 从查询参数获取用户问题
    @Query('sessionId') sessionId: string, // 从查询参数获取会话 ID
    @CurrentUser() user: { id: string; username: string }, // 从装饰器获取当前用户
  ): Promise<Observable<MessageEvent>> { // 返回类型为 SSE 消息可观察流
    // 如果未传 sessionId 则自动生成一个新的
    const sid = sessionId || randomUUID();
    // 调用服务层带历史的流式聊天方法
    const stream = await this.aiService.streamChatWithHistory(question, sid, user.id);
    // 将流数据转换为 Observable 并通过 pipe 管道处理
    return from(stream).pipe(
      // map 操作符：将每个数据块转换为 SSE 消息格式
      map((chunk) => {
        // 定义文本提取函数，兼容 string 和 ContentBlock[] 两种格式
        const extractText = (c: any): string =>
          // 字符串类型直接返回
          typeof c === 'string' ? c
            // 数组类型过滤出文本块并拼接
            : Array.isArray(c)
              ? c.filter((b: any) => b.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('')
              // 其他类型返回空字符串
              : '';
        // 判断是否为 LangChain 基础消息并提取内容
        const content = isBaseMessage(chunk)
          ? extractText(chunk.content) // 从消息对象提取文本
          : String(chunk); // 直接转为字符串
        // 返回 SSE 消息事件对象
        return { data: content };
      }),
      // filter 操作符：过滤掉空数据的事件
      filter((event) => !!event.data),
    );
  }
}
