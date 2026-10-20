// 导入 NestJS 核心装饰器：Controller(控制器)、Post(POST 路由)、Body(请求体解析)、Sse(服务端事件)、MessageEvent(SSE 消息类型)、Get(GET 路由)、UseGuards(守卫)、Param(路由参数)、UseInterceptors(拦截器)、UploadedFile(上传文件)
import { Controller, Post, Body, Sse, MessageEvent, Get, UseGuards, Param, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
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
// 按用户计数的限流守卫（必须排在 JwtAuthGuard 之后，档位定义见该文件）
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard';
// 导入当前用户装饰器，从请求中提取用户信息
import { CurrentUser } from '../../common/decorators/current-user.decorator';
// 权限守卫 + @Permissions 装饰器：做接口级权限码校验
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

// 控制器级别守卫装饰器：所有接口均需 JWT 认证 + 权限码校验 + 限流保护
//
// ⚠️ PermissionsGuard 不能省：AI 接口会调用按量计费的 LLM 并写入向量库，
// 此前这里只有 JwtAuthGuard —— 等同于"登录即可免费调用"。
// 新注册用户在 nest-db.sql 的种子数据里默认不带任何角色，
// 只校验登录态意味着任何人都能直接刷爆第三方 API 账单。
// 权限码 ai:chat / ai:doc:private 已在 nest-db.sql 的 16.3 段定义
// 并授予 admin / editor / user 三个内置角色。
//
// 注：PermissionsGuard 用 getAllAndOverride 读取，**方法级装饰器会覆盖类级**。
// 下面 upload/pdf 等方法自带 @Permissions('ai:doc:private')，因此不再要求 ai:chat。
//
// 限流用 UserThrottlerGuard 且在 JwtAuthGuard **之后**：前者按用户 ID 计数，
// 依赖后者已经写好 req.user。顺序颠倒会静默退化成按 IP 计数。
// 全局基线（300 次/分钟/IP）仍由 APP_GUARD 兜底，两者叠加生效。
@UseGuards(JwtAuthGuard, PermissionsGuard, UserThrottlerGuard)
@Permissions('ai:chat')
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
    // 调用服务层简单问答方法，传入用户问题（TransformInterceptor 自动包装）
    return this.aiService.simpleChat(dto.question);
  }

  // POST 路由装饰器：注册 /ai/chat/history 接口
  @Post('chat/history')
  // 带会话历史的多轮对话接口，接收请求体和当前用户信息
  async chatHistory(@Body() dto: ChatDto, @CurrentUser() user: { id: string; username: string }) {
    // 如果未传 sessionId 则自动生成一个新的 UUID
    const sessionId = dto.sessionId || randomUUID();
    // 调用服务层带历史上下文的问答方法
    const data = await this.aiService.chatWithHistory(dto.question, sessionId, user.id);
    // 返回数据，包含 sessionId 用于前端关联（TransformInterceptor 自动包装）
    return { data, sessionId };
  }

  // POST 路由装饰器：注册 /ai/rag 接口
  //
  // 检索范围恒为「公共知识库 + 当前用户自己的私有资料」，用户维度来自 JWT，
  // **不接受客户端传 userId** —— 否则任何人都能指定别人的私有库来提问。
  @Post('rag')
  // RAG 知识库问答接口处理函数
  async ragChat(@Body() dto: ChatDto, @CurrentUser() user: { id: string; username: string }) {
    // 调用服务层 RAG 问答方法，基于向量检索回答
    return this.aiService.ragQuery(dto.question, user.id);
  }

  // POST 路由装饰器：注册 /ai/stream 接口
  //
  // 与 streamWithHistory 同理改 POST：问题原文不该进 URL / access log。
  // 这里同样换成 ChatDto —— 原先 @Query 取参绕过 DTO，长度上限完全没生效，
  // 只在方法体里手动挡了空值。
  //
  // ⚠️ 仓库内已无调用方：前端只用 stream/history，admin 侧完全不用。
  // 这是一条每次都真实花钱调 LLM 的接口，留着只是多余的暴露面。
  // 本次只做等价改造（GET → POST + DTO）不删除，避免顺带改掉对外契约；
  // 确认无外部消费方后，建议连同 AiService.streamChat 一起下线。
  @Post('stream')
  // SSE 装饰器：标识该接口为 Server-Sent Events 流式输出
  @Sse()
  // 流式输出接口处理函数，接收请求体中的问题，返回可观察的 SSE 消息流
  @ApiOperation({ summary: 'SSE 流式输出（单轮，无历史上下文）' })
  async stream(@Body() dto: ChatDto): Promise<Observable<MessageEvent>> {
    if (!dto.question.trim()) {
      throw new BadRequestException('提问内容不能为空');
    }
    // 调用服务层流式聊天方法，获取原始流
    const stream = await this.aiService.streamChat(dto.question);
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
    // 返回包含 sessionId 的数据（TransformInterceptor 自动包装）
    return { sessionId };
  }

  // GET 路由装饰器：注册 /ai/session/last 接口
  @Get('session/last')
  // Swagger 操作描述：获取用户最近一次会话
  @ApiOperation({ summary: '获取用户最近一次会话' })
  // 获取最近会话接口处理函数
  async getLastSession(@CurrentUser() user: { id: string; username: string }) {
    // 调用服务层获取用户最近一次会话的方法
    return this.aiService.getLastSession(user.id);
  }

  // POST 路由装饰器：注册 /ai/upload/pdf 接口
  //
  // handler 级 @Permissions('ai:doc:private') **覆盖**类级的 'ai:chat'
  // （PermissionsGuard 用 getAllAndOverride，不是 AND）—— 语义上这正是想要的：
  // 这个接口管的是「我的资料」，与能否用 AI 对话是两件事。
  @Post('upload/pdf')
  // 权限码：仅拥有 ai:doc:private 的用户可上传私有资料
  @Permissions('ai:doc:private')
  // Swagger 操作描述：上传 PDF 到个人私有知识库
  @ApiOperation({ summary: '上传 PDF 到个人私有知识库（仅本人可检索）' })
  // Swagger 声明该接口消费 multipart/form-data 类型
  @ApiConsumes('multipart/form-data')
  // 使用文件上传拦截器，限制文件大小为 20MB
  // 未指定 storage → multer 走默认的 memoryStorage，文件内容在 file.buffer 里。
  // 下游必须用 buffer，不能用 file.path（memoryStorage 下 path 恒为 undefined）。
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
      // busboy 默认用 latin1 解析 multipart 头里的文件名，浏览器的 UTF-8
      // 中文名会被解成 `æå...` 这类乱码，并原样写进 Chroma metadata。
      // 显式声明 UTF-8，保证「我的资料」列表显示的是真实文件名。
      defParamCharset: 'utf8',
    }),
  )
  // PDF 上传接口处理函数，接收上传的文件与当前用户
  async uploadPdf(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { id: string; username: string },
  ) {
    // 先判空：不带文件时 file 为 undefined，直接取 .buffer 会抛 TypeError → 500
    if (!file?.buffer?.length) {
      throw new BadRequestException('请选择要上传的 PDF 文件');
    }
    // 调用服务层将 PDF 解析并存入**该用户私有** collection 的方法
    // （内部会校验 PDF 魔术字节与 userId）
    return this.aiService.uploadPrivatePdf(file.buffer, file.originalname, user.id);
  }

  // GET 路由装饰器：注册 /ai/documents 接口
  @Get('documents')
  // Swagger 操作描述：列出当前用户的私有资料
  @ApiOperation({ summary: '列出当前用户的私有资料' })
  // 列出私有资料接口处理函数
  async listMyDocuments(@CurrentUser() user: { id: string; username: string }) {
    return this.aiService.listPrivateDocs(user.id);
  }

  // POST 路由装饰器：注册 /ai/documents/:docId/delete 接口
  //
  // 用 POST 而不是 DELETE：与全仓既有的会话删除接口（session/:id/delete）保持一致，
  // 前端 request 封装也不需要额外放行 DELETE 动词。
  @Post('documents/:docId/delete')
  // 权限码：与上传同码，能传就能删自己的
  @Permissions('ai:doc:private')
  // Swagger 操作描述：删除当前用户的私有资料
  @ApiOperation({ summary: '删除当前用户的私有资料' })
  // 删除私有资料接口处理函数
  async deleteMyDocument(
    @Param('docId') docId: string,
    @CurrentUser() user: { id: string; username: string },
  ) {
    // docId 由路由参数传入，服务层在私有作用域下会附带 userId 条件，
    // 即便 docId 是他人的也删不掉
    const removed = await this.aiService.deletePrivateDoc(docId, user.id);
    // 返回实际删除的切块数，0 表示该文档不存在或不属于当前用户
    return { msg: '资料已删除', removed };
  }

  // GET 路由装饰器：注册 /ai/sessions 接口
  @Get('sessions')
  // Swagger 操作描述：列出用户的所有会话
  @ApiOperation({ summary: '列出用户的会话' })
  // 列出用户会话接口处理函数
  async listSessions(@CurrentUser() user: { id: string; username: string }) {
    // 调用服务层获取用户所有会话列表的方法
    return this.aiService.listSessions(user.id);
  }

  // POST 路由装饰器：注册 /ai/session/:sessionId/delete 接口
  @Post('session/:sessionId/delete')
  // Swagger 操作描述：删除单个会话
  @ApiOperation({ summary: '删除单个会话' })
  // 删除会话接口处理函数，接收路由参数中的 sessionId 和当前用户
  async deleteSession(@Param('sessionId') sessionId: string, @CurrentUser() user: { id: string; username: string }) {
    // 调用服务层删除指定会话的方法
    await this.aiService.deleteSession(user.id, sessionId);
    // 返回操作提示消息
    return { msg: '会话已删除' };
  }

  // POST 路由装饰器：注册 /ai/sessions/clear 接口
  @Post('sessions/clear')
  // Swagger 操作描述：清空当前用户所有会话历史
  @ApiOperation({ summary: '清空当前用户所有会话历史' })
  // 清空所有会话接口处理函数
  async clearSessions(@CurrentUser() user: { id: string; username: string }) {
    // 调用服务层清空用户所有会话的方法
    await this.aiService.clearSessions(user.id);
    // 返回操作提示消息
    return { msg: '所有会话已清空' };
  }

  // GET 路由装饰器：注册 /ai/session/:sessionId/messages 接口
  @Get('session/:sessionId/messages')
  // Swagger 操作描述：获取指定会话的历史消息
  @ApiOperation({ summary: '获取指定会话的历史消息' })
  // 获取会话历史消息接口处理函数
  async getSessionMessages(
    @Param('sessionId') sessionId: string, // 从路由参数获取会话 ID
    @CurrentUser() user: { id: string; username: string }, // 从装饰器获取当前用户
  ) {
    // 调用服务层获取指定会话的历史消息
    return this.aiService.getSessionMessages(user.id, sessionId);
  }

  // POST 路由装饰器：注册 /ai/stream/history 接口
  //
  // 用 POST 而不是 GET：问题原文此前是查询参数，会**原样进 URL**，于是出现在
  // nginx 的 access log（$request 默认落盘）、CDN / 反向代理日志、浏览器历史里。
  // 用户问的可能是一段带密钥的代码或内部资料 —— 这些内容不该出现在运维日志里，
  // 排查问题时也不该被任何人顺手读到。放到请求体后，日志里只剩下路径。
  // 前端本来就用 fetch 手动读流（不是 EventSource），改用 POST 无额外代价。
  //
  // 顺带把参数换成 ChatDto：原先 @Query 直接取参**绕过 DTO**，@MaxLength 全部失效，
  // 只能在方法体里手写一遍长度校验（超长 question 按 token 计费、
  // 超长 sessionId 会在付费调用之后才因 VARCHAR(36) 溢出报 500）。
  // 走 DTO 后这些由全局 ValidationPipe 统一兜住。
  @Post('stream/history')
  // SSE 装饰器：标识该接口为 Server-Sent Events 流式输出
  @Sse()
  // Swagger 操作描述：SSE 流式输出（带历史上下文）
  @ApiOperation({ summary: 'SSE 流式输出（带历史上下文）' })
  // 带历史的流式输出接口，接收问题、sessionId 和当前用户
  async streamWithHistory(
    @Body() dto: ChatDto, // 请求体：question（必填）+ sessionId（可选），校验见 ChatDto
    @CurrentUser() user: { id: string; username: string }, // 从装饰器获取当前用户
  ): Promise<Observable<MessageEvent>> { // 返回类型为 SSE 消息可观察流
    // DTO 的 @IsNotEmpty 只挡空串，挡不住纯空白。这里补上 trim 判定，
    // 否则 "   " 会一路传到 LLM 调用里变成一次纯付钱的空提问。
    if (!dto.question.trim()) {
      throw new BadRequestException('提问内容不能为空');
    }
    // 如果未传 sessionId 则自动生成一个新的
    const sid = dto.sessionId || randomUUID();
    // 调用服务层带历史的流式聊天方法
    const stream = await this.aiService.streamChatWithHistory(dto.question, sid, user.id);
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
