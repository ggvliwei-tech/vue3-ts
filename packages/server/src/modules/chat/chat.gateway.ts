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
// 导入 NestJS 日志工具类，用于统一日志输出
import { Logger } from '@nestjs/common';
// 导入 JWT 服务，用于验证和解析 Token
import { JwtService } from '@nestjs/jwt';
// 导入配置服务，用于读取环境变量和配置文件
import { ConfigService } from '@nestjs/config';

// @WebSocketGateway() 装饰器声明此类为 WebSocket 网关，配置命名空间和跨域
@WebSocketGateway({
  namespace: '/ws',   // 命名空间配置，所有 WebSocket 路径以 /ws 开头
  cors: {
    // 允许的跨域来源列表，仅允许开发环境前端地址
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    // 允许携带凭证（cookie、认证头）进行跨域请求
    credentials: true,
  },
})
// 定义 ChatGateway 类，实现连接和断开连接的生命周期接口
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  // @WebSocketServer() 装饰器注入 Socket.IO Server 实例
  @WebSocketServer()
  // 声明 Socket.IO Server 实例，用于向所有客户端广播消息
  server: Server;

  // 创建 WebSocket 专用日志实例，日志标签为 'WebSocket'
  private readonly logger = new Logger('WebSocket');

  // 构造函数，注入 JWT 服务和配置服务
  constructor(
    private readonly jwtService: JwtService,         // 注入 JWT 服务，用于验证 Token
    private readonly configService: ConfigService,   // 注入配置服务，用于读取 JWT 密钥
  ) {}

  // handleConnection 方法在客户端连接时自动触发
  async handleConnection(client: Socket) {
    try {
      // 从握手认证数据中获取 token，前端连接时需携带 { auth: { token: 'Bearer xxx' } }
      // 前端连接时应携带: io('/ws', { auth: { token: 'Bearer xxx' } })
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

      // 将 Token 载荷绑定到 socket 的 data 上，后续可通过 client.data.user 获取 { sub, username }
      client.data = { user: payload };
      // 输出客户端上线日志，包含客户端 ID 和用户 ID
      this.logger.log(`客户端上线: ${client.id}, 用户ID: ${payload.sub}`);
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
  handleDisconnect(client: Socket) {
    // 输出客户端下线日志，包含客户端 ID
    this.logger.log(`客户端下线: ${client.id}`);
  }

  // @SubscribeMessage('send-msg') 装饰器监听客户端发送的 'send-msg' 事件
  @SubscribeMessage('send-msg')
  // handleMessage 处理客户端发送消息事件，client 为发送方 socket，payload 为消息内容
  handleMessage(client: Socket, payload: string) {
    // 输出收到消息的日志
    this.logger.log(`收到消息：${payload}`);

    // 1. 推送给当前发送消息的客户端，回复 reply 事件
    client.emit('reply', { code: 200, data: payload });
    // 2. 广播给所有在线的其他用户（除发送者自己），触发 broadcast 事件
    client.broadcast.emit('broadcast', payload);
    // 3. 全员推送（包含自己），当前已注释
    // this.server.emit('all', payload);
  }

  // @SubscribeMessage('join-room') 装饰器监听客户端发送的 'join-room' 事件
  @SubscribeMessage('join-room')
  // joinRoom 处理客户端加入房间事件，client 为客户端 socket，roomId 为房间 ID
  joinRoom(client: Socket, roomId: string) {
    // 调用 client.join() 将客户端加入指定的 Socket.IO 房间
    client.join(roomId);
    // 向客户端发送进入房间成功消息，触发 'room-info' 事件
    client.emit('room-info', `已进入房间${roomId}`);
  }
}
