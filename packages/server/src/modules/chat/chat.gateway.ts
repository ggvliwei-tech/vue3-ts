// 导入 WebSocket 相关装饰器
import {
  WebSocketGateway,         // WebSocket 网关装饰器
  WebSocketServer,          // WebSocket 服务实例装饰器
  SubscribeMessage,         // 订阅消息事件装饰器
  OnGatewayConnection,      // 网关连接事件接口
  OnGatewayDisconnect,      // 网关断开事件接口
} from '@nestjs/websockets';
// 导入 Socket.IO 服务类和 Socket 类型
import { Server, Socket } from 'socket.io';
// 导入 NestJS 日志工具
import { Logger } from '@nestjs/common';
// 导入 JWT 服务
import { JwtService } from '@nestjs/jwt';
// 导入配置服务
import { ConfigService } from '@nestjs/config';

// WebSocket 网关配置，全局路由前缀 /ws，明确指定允许的跨域来源
@WebSocketGateway({
  namespace: '/ws',   // 命名空间，所有 WebSocket 路径以 /ws 开头
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:5174'], // 仅允许开发环境前端地址
    credentials: true,
  },
})
// 实现连接和断开事件接口
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  // WebSocket 服务实例，可用于向所有客户端发送消息
  @WebSocketServer()
  server: Server;

  // 创建 WebSocket 专用日志实例
  private readonly logger = new Logger('WebSocket');

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // 客户端连接时触发，验证 Token
  async handleConnection(client: Socket) {
    try {
      // 从握手数据中获取 token
      // 前端连接时应携带: io('/ws', { auth: { token: 'Bearer xxx' } })
      const auth = client.handshake?.auth?.token as string;
      if (!auth) {
        client.emit('error', { code: 401, msg: '未携带Token，请先登录' });
        client.disconnect();
        return;
      }

      const [type, token] = auth.split(' ');
      if (type !== 'Bearer' || !token) {
        client.emit('error', { code: 401, msg: 'Token格式错误' });
        client.disconnect();
        return;
      }

      // 验证 Token
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });

      // 将 Token 载荷绑定到 socket 上，后续可通过 client.data.user 获取 { sub, username }
      client.data = { user: payload };
      this.logger.log(`客户端上线: ${client.id}, 用户ID: ${payload.sub}`);
    } catch (err) {
      this.logger.warn(`客户端认证失败: ${client.id}, ${err.message}`);
      client.emit('error', { code: 401, msg: 'Token已过期或无效' });
      client.disconnect();
    }
  }

  // 客户端断开连接时触发
  handleDisconnect(client: Socket) {
    this.logger.log(`客户端下线: ${client.id}`);
  }

  // 监听客户端发送的 send-msg 事件
  @SubscribeMessage('send-msg')
  handleMessage(client: Socket, payload: string) {
    this.logger.log(`收到消息：${payload}`);

    // 1. 推送给当前客户端
    client.emit('reply', { code: 200, data: payload });
    // 2. 广播给所有在线用户（除自己）
    client.broadcast.emit('broadcast', payload);
    // 3. 全员推送（包含自己）
    // this.server.emit('all', payload);
  }

  // 监听客户端发送的 join-room 事件，加入指定房间
  @SubscribeMessage('join-room')
  joinRoom(client: Socket, roomId: string) {
    // 将客户端加入指定房间
    client.join(roomId);
    // 向客户端发送进入成功消息
    client.emit('room-info', `已进入房间${roomId}`);
  }
}
