// 从 @nestjs/websockets 导入 WebSocket 相关装饰器和接口
import {
  WebSocketGateway,         // WebSocket 网关装饰器，用于声明 WebSocket 服务
  WebSocketServer,          // WebSocket 服务实例装饰器，用于注入 Socket.IO Server
  SubscribeMessage,         // 订阅消息事件装饰器，用于监听客户端消息
  OnGatewayConnection,      // 网关连接事件接口，实现连接时的回调
  OnGatewayDisconnect,      // 网关断开事件接口，实现断开时的回调
} from '@nestjs/websockets';
// 导入 Socket.IO 的 Server 服务类和 Socket 客户端类型
import { Server, Socket } from 'socket.io';
// 导入 NestJS 日志工具类、校验管道
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
// 导入 JWT 服务，用于验证和解析 Token
import { JwtService } from '@nestjs/jwt';
// 导入配置服务，用于读取环境变量和配置文件
import { ConfigService } from '@nestjs/config';
// 导入聊天服务，用于房间管理和消息持久化
import { ChatService } from './chat.service';
// 导入发送消息 DTO，用于 WebSocket 消息校验
import { SendMessageDto } from './dto/send-message.dto';
// Redis 服务，用于黑名单检查
import { RedisService } from '../redis/redis.service';
// 用户服务，用于 status 校验
import { UserService } from '../user/user.service';

// @WebSocketGateway() 装饰器声明此类为 WebSocket 网关，配置命名空间和跨域
@WebSocketGateway({
  namespace: '/ws',   // 命名空间配置，所有 WebSocket 路径以 /ws 开头
  cors: {
    // 允许的跨域来源列表，仅允许开发环境前端地址
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'],
    // 允许携带凭证（cookie、认证头）进行跨域请求
    credentials: true,
  },
})
// 定义 ChatGateway 类，实现连接和断开连接的生命周期接口
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  // @WebSocketServer() 装饰器注入 Socket.IO Server 实例
  @WebSocketServer()
  // 声明 Socket.IO Server 实例，用于向房间广播消息
  server: Server;

  // 创建 WebSocket 专用日志实例，日志标签为 'WebSocket'
  private readonly logger = new Logger('WebSocket');

  // 构造函数，注入 JWT 服务、配置服务和聊天服务
  constructor(
    private readonly jwtService: JwtService,         // 注入 JWT 服务，用于验证 Token
    private readonly configService: ConfigService,   // 注入配置服务，用于读取 JWT 密钥
    private readonly chatService: ChatService,       // 注入聊天服务，用于房间管理和消息持久化
    private readonly redisService: RedisService,     // 注入 Redis 服务，用于黑名单检查
    private readonly userService: UserService,       // 注入用户服务，用于 status 校验
  ) {}

  // handleConnection 方法在客户端连接时自动触发
  async handleConnection(client: Socket) {
    try {
      // 从握手认证数据中获取 token，前端连接时需携带 { auth: { token: 'Bearer xxx' } }
      const auth = client.handshake?.auth?.token as string;
      // 如果未携带认证信息
      if (!auth) {
        // 向客户端发送未授权错误事件
        client.emit('error', { code: 401, msg: '未携带Token，请先登录' });
        // 断开该客户端的连接
        client.disconnect();
        // 结束处理
        return;
      }

      // 将 auth 字符串按空格分割，分离类型和 token 值
      const [type, token] = auth.split(' ');
      // 如果类型不是 Bearer 或 token 为空
      if (type !== 'Bearer' || !token) {
        // 向客户端发送 token 格式错误事件
        client.emit('error', { code: 401, msg: 'Token格式错误' });
        // 断开该客户端的连接
        client.disconnect();
        // 结束处理
        return;
      }

      // 调用 jwtService 验证 Token 有效性
      const payload = this.jwtService.verify(token, {
        // 使用配置文件中的 JWT_ACCESS_SECRET 作为密钥
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });

      // 安全加固：检查 Redis 黑名单（与 JwtAuthGuard 保持一致）
      // 如果用户被踢下线或触发 RT 复用检测，blacklist:token:{sub} 会存在
      const isBlacklisted = await this.redisService.exists(`blacklist:token:${payload.sub}`)
      if (isBlacklisted) {
        this.logger.warn(`WS 连接被拒: 用户 ${payload.username} 已在黑名单中`);
        client.emit('error', { code: 401, msg: '账号已被强制下线，请重新登录' });
        client.disconnect();
        return;
      }

      // 安全加固：检查用户 status（账号是否被禁用）
      // 不依赖 JWT payload，因为 token 签发后状态可能已变
      const user = await this.userService.findUserEntity(payload.sub);
      if (!user) {
        this.logger.warn(`WS 连接被拒: 用户 ${payload.username} 不存在`);
        client.emit('error', { code: 401, msg: '用户不存在' });
        client.disconnect();
        return;
      }
      if (user.status === 0) {
        this.logger.warn(`WS 连接被拒: 用户 ${user.username} 已被禁用`);
        client.emit('error', { code: 401, msg: '账号已被禁用，请联系管理员' });
        client.disconnect();
        return;
      }

      // 将 Token 载荷绑定到 socket 的 data 上，后续可通过 client.data.user 获取 { sub, username }
      client.data = { user: payload };
      // 输出客户端上线日志，包含客户端 ID 和用户 ID
      this.logger.log(`客户端上线: ${client.id}, 用户: ${payload.username}`);
    } catch (err) {
      // 捕获异常，输出认证失败警告日志
      this.logger.warn(`客户端认证失败: ${client.id}, ${err.message}`);
      // 向客户端发送 token 过期或无效错误
      client.emit('error', { code: 401, msg: 'Token已过期或无效' });
      // 断开该客户端的连接
      client.disconnect();
    }
  }

  // handleDisconnect 方法在客户端断开连接时自动触发
  async handleDisconnect(client: Socket) {
    // 获取用户信息
    const user = client.data?.user;
    // 如果用户信息不存在，直接返回
    if (!user) {
      this.logger.log(`客户端下线: ${client.id}`);
      return;
    }

    // 获取该客户端加入的所有房间（排除 socket.io 自动创建的以 client.id 为名的默认房间）
    const rooms = Array.from(client.rooms).filter(r => r !== client.id);
    // 遍历所有房间，执行清理逻辑
    for (const roomId of rooms) {
      // 从数据库中移除成员记录
      await this.chatService.leaveRoom(Number(roomId), user.sub);
      // 向房间内其他成员广播用户离开事件
      this.server.to(roomId).emit('member-left', {
        userId: user.sub,           // 离开的用户 ID
        username: user.username,    // 离开的用户名
        roomId: Number(roomId),     // 房间 ID
      });
    }
    // 输出客户端下线日志
    this.logger.log(`客户端下线: ${client.id}, 用户: ${user.username}`);
  }

  // @SubscribeMessage('send-msg') 装饰器监听客户端发送的 'send-msg' 事件
  @SubscribeMessage('send-msg')
  // 使用校验管道对消息 payload 进行 DTO 校验
  @UsePipes(new ValidationPipe({ transform: true }))
  // handleMessage 处理客户端发送消息事件
  async handleMessage(client: Socket, payload: SendMessageDto) {
    // 获取用户信息
    const user = client.data?.user;
    // 如果用户信息不存在，直接返回
    if (!user) return;

    // 从校验后的 payload 中提取房间 ID 和消息内容
    const { roomId, content } = payload;
    // 将 roomId 转为 Socket.IO 房间 ID 字符串
    const roomSocketId = String(roomId);

    // 验证客户端是否真的在该房间的 Socket.IO 房间中
    const rooms = Array.from(client.rooms);
    // 如果不在该房间，拒绝发送
    if (!rooms.includes(roomSocketId)) {
      client.emit('error', { code: 403, msg: '您不在该房间中' });
      return;
    }

    // 1. 持久化消息到数据库
    const saved = await this.chatService.saveMessage(
      roomId,             // 房间 ID
      user.sub,           // 发送者 ID
      user.username,      // 发送者用户名
      content,            // 消息内容
    );

    // 2. 房间级广播新消息（排除发送者自己）
    client.broadcast.to(roomSocketId).emit('new-msg', {
      id: saved.id,               // 消息 ID
      roomId,                     // 房间 ID
      senderId: user.sub,         // 发送者 ID
      senderName: user.username,  // 发送者用户名
      content,                    // 消息内容
      createdAt: saved.createdAt, // 发送时间戳
    });

    // 3. 确认发送者自己的消息（携带数据库 ID）
    client.emit('msg-sent', {
      id: saved.id,               // 消息 ID
      roomId,                     // 房间 ID
      senderId: user.sub,         // 发送者 ID
      senderName: user.username,  // 发送者用户名
      content,                    // 消息内容
      createdAt: saved.createdAt, // 发送时间戳
    });
  }

  // @SubscribeMessage('join-room') 装饰器监听客户端发送的 'join-room' 事件
  @SubscribeMessage('join-room')
  // joinRoom 处理客户端加入房间事件
  async joinRoom(client: Socket, payload: { roomId: number }) {
    // 获取用户信息
    const user = client.data?.user;
    // 如果用户信息不存在，直接返回
    if (!user) return;

    // 从 payload 中提取房间 ID
    const { roomId } = payload;
    // 将 roomId 转为 Socket.IO 房间 ID 字符串
    const roomSocketId = String(roomId);

    try {
      // 1. 将客户端加入 Socket.IO 房间
      client.join(roomSocketId);

      // 2. 在数据库中记录成员关系（若已在房间中会抛异常被 catch 捕获）
      await this.chatService.joinRoom(roomId, user.sub, user.username);

      // 3. 获取房间成员列表
      const members = await this.chatService.getRoomMembers(roomId);

      // 4. 获取最近 50 条历史消息
      const history = await this.chatService.getRecentMessages(roomId, 50);

      // 5. 向客户端发送加入成功确认，携带成员列表和历史消息
      client.emit('room-joined', {
        roomId,                 // 房间 ID
        members,                // 成员列表
        history,                // 历史消息列表
      });

      // 6. 向房间内其他用户广播有新成员加入
      client.broadcast.to(roomSocketId).emit('member-joined', {
        userId: user.sub,           // 新加入的用户 ID
        username: user.username,    // 新加入的用户名
        roomId,                     // 房间 ID
      });

      // 输出加入房间日志
      this.logger.log(`用户 ${user.username} 加入房间 ${roomId}`);
    } catch (err) {
      // 加入失败时向客户端发送错误信息
      client.emit('error', { code: 400, msg: err.message });
    }
  }

  // @SubscribeMessage('leave-room') 装饰器监听客户端发送的 'leave-room' 事件
  @SubscribeMessage('leave-room')
  // leaveRoom 处理客户端离开房间事件
  async leaveRoom(client: Socket, payload: { roomId: number }) {
    // 获取用户信息
    const user = client.data?.user;
    // 如果用户信息不存在，直接返回
    if (!user) return;

    // 从 payload 中提取房间 ID
    const { roomId } = payload;
    // 将 roomId 转为 Socket.IO 房间 ID 字符串
    const roomSocketId = String(roomId);

    // 1. 将客户端从 Socket.IO 房间中移除
    client.leave(roomSocketId);

    // 2. 从数据库中移除成员记录
    await this.chatService.leaveRoom(roomId, user.sub);

    // 3. 向房间内剩余用户广播该用户离开
    this.server.to(roomSocketId).emit('member-left', {
      userId: user.sub,           // 离开的用户 ID
      username: user.username,    // 离开的用户名
      roomId,                     // 房间 ID
    });

    // 输出离开房间日志
    this.logger.log(`用户 ${user.username} 离开房间 ${roomId}`);
  }
}
