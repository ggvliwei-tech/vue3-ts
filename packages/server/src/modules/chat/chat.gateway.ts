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
// RBAC 服务，用于 WS 连接时校验 chat:room 权限（RbacModule 为 @Global，无需在 ChatModule 中 import）
import { RbacService } from '../rbac/rbac.service';
// 认证相关 Redis key（集中定义，避免手工拼接导致 key 漂移）
import { AuthKeys } from '../../common/constants/auth-keys';

/**
 * socket.data 的形状
 *
 * rooms 是**我们自己维护**的「该 socket 当前加入了哪些 Socket.IO 房间」列表，
 * 刻意不依赖 socket.rooms —— 在 handleDisconnect 里那个值恒为空：
 * socket.io 触发 'disconnect' 之前会先执行 _cleanup() → adapter.delAll(id)，
 * 而 socket.rooms 是个 getter（读 adapter.socketRooms(id)），此时返回 undefined 并被
 * 兜底成空 Set。也就是说 handleDisconnect 里读 client.rooms 拿不到任何房间。
 *   （依据：socket.io 4.8.3 dist/socket.js 的 _onclose —— _cleanup() 在
 *     emitReserved("disconnect") 之前；@nestjs/websockets 的 ws-adapter.js
 *     绑的事件正是 DISCONNECT_EVENT = 'disconnect'）
 * 这就是原代码「断开时清理房间成员」那段逻辑从未生效的原因。
 */
interface WsSocketData {
  // 连接时由 JWT 载荷写入
  user?: { sub: number; username: string };
  // 加入/离开房间时维护，供 handleDisconnect 使用
  rooms?: string[];
}

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
    private readonly rbacService: RbacService,       // 注入 RBAC 服务，用于 WS 连接时的权限码校验
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
      // 安全加固：显式指定 algorithms 防止 alg=none / RS256→HS256 攻击
      const payload = this.jwtService.verify(token, {
        // 使用配置文件中的 JWT_ACCESS_SECRET 作为密钥
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        // 锁定算法白名单，与 JwtAuthGuard 保持一致
        algorithms: ['HS256'],
      });

      // 安全加固：检查 Redis 黑名单（与 JwtAuthGuard 保持一致）
      // 两种粒度都要查，缺任一种都会让对应的踢下线操作被 WS 绕过：
      //  - 用户级：踢全部设备（forceKick 不带 sessionId / logout-all）
      //  - 设备级：仅踢当前设备（RT 复用检测 / 踢指定设备）
      const blacklistChecks = [
        this.redisService.exists(AuthKeys.blacklistUser(payload.sub)),
      ];
      if (payload.sessionId) {
        blacklistChecks.push(
          this.redisService.exists(
            AuthKeys.blacklistSession(payload.sub, payload.sessionId),
          ),
        );
      }
      const blacklistHits = await Promise.all(blacklistChecks);
      if (blacklistHits.some((hit) => hit)) {
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

      // RBAC 校验：WS 与 REST 走的是两条链路，REST 上的 PermissionsGuard 管不到这里。
      // 没有 chat:room 权限的用户即使拿到合法 Token 也不能建立长连接，
      // 否则前端隐藏入口 + REST 拦截仍可被直连 socket 绕过。
      const permissions = await this.rbacService.getUserPermissions(payload.sub);
      if (!permissions.includes('chat:room')) {
        this.logger.warn(`WS 连接被拒: 用户 ${user.username} 缺少 chat:room 权限`);
        client.emit('error', { code: 403, msg: '无聊天室访问权限' });
        client.disconnect();
        return;
      }

      // 将 Token 载荷绑定到 socket 的 data 上，后续可通过 client.data.user 获取 { sub, username }
      // rooms 由 join-room / leave-room 维护（原因见 WsSocketData 的注释）
      client.data = { user: payload, rooms: [] as string[] };
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

  /**
   * 计算房间内真实在线的用户，并向房间广播全量的在线快照
   *
   * 在线状态用 Socket.IO 自己的房间成员快照算，不落库也不进 Redis：
   * 单实例部署下（未装 @socket.io/redis-adapter）这是唯一准确且不会产生陈旧数据的来源。
   * 按 socket 计数再按 userId 去重，因此同一用户开多个标签页只算一个在线。
   *
   * 这是 onlineUserIds 的**唯一**来源：客户端只在这个事件里整体覆盖，
   * member-joined / member-left 不再参与在线集合的加减，避免增量同步在多标签页、
   * 断线重连、事件重复投递下永久漂移。
   *
   * @param excludeClientId 需要排除的 socket（正在断开/离开的那个）。
   *        实际上 handleDisconnect 被调用时该 socket 已被 _cleanup() 移出适配器，
   *        fetchSockets 不会再返回它；这里显式排除是把这条隐式保证写明白，
   *        避免将来换适配器或改绑 'disconnecting' 时静默出错。
   * @returns 本次广播的在线用户 ID 列表，调用方据此判断是否要发 member-left
   */
  private async broadcastPresence(roomId: number, excludeClientId?: string): Promise<number[]> {
    // Room 类型是 string，必须转成字符串再传
    const roomSocketId = String(roomId);
    const sockets = await this.server.in(roomSocketId).fetchSockets();
    const onlineUserIds = [
      ...new Set(
        sockets
          .filter((s) => s.id !== excludeClientId)
          .map((s) => (s.data as WsSocketData | undefined)?.user?.sub)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    this.server.to(roomSocketId).emit('presence', { roomId, onlineUserIds });
    return onlineUserIds;
  }

  // handleDisconnect 方法在客户端断开连接时自动触发
  async handleDisconnect(client: Socket) {
    // 获取用户信息
    const data = client.data as WsSocketData | undefined;
    const user = data?.user;
    // 如果用户信息不存在，直接返回
    if (!user) {
      this.logger.log(`客户端下线: ${client.id}`);
      return;
    }

    // 房间列表取自 client.data.rooms 而非 client.rooms —— 后者在这里恒为空，原因见 WsSocketData 注释
    for (const roomSocketId of data?.rooms ?? []) {
      const roomId = Number(roomSocketId);
      // 断开**不删成员记录**：chat_member 是持久成员关系，在线与否由下面的 presence 表达。
      // 这里以前调 chatService.leaveRoom()，是与「进入房间」互相覆盖的竞态来源之一；
      // 更要命的是它让「关掉页面」被误当成「退出房间」，把用户的成员资格删掉。
      const onlineUserIds = await this.broadcastPresence(roomId, client.id);

      // 多标签页友好：该用户还有别的 socket 在这个房间里时，他只是少开了一个页面，不算离开
      if (!onlineUserIds.includes(user.sub)) {
        // 向房间内其他成员广播用户离开事件
        this.server.to(roomSocketId).emit('member-left', {
          userId: user.sub,           // 离开的用户 ID
          username: user.username,    // 离开的用户名
          roomId,                     // 房间 ID
        });
      }
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
      this.logger.warn(
        `WS 发送被拒: 用户 ${user.username} 不在 Socket.IO 房间 ${roomId}`,
      );
      client.emit('error', { code: 403, msg: '您不在该房间中' });
      return;
    }

    // 防御兜底：再校验一次 DB 成员关系
    // 目的：防止 DB 写入失败 / 异步竞争导致 socket.join 成功但 DB 无成员
    // 这种情况下表面 rooms 在，实际无权发送
    const isDbMember = await this.chatService.isUserInRoom(user.sub, roomId);
    if (!isDbMember) {
      this.logger.warn(
        `WS 发送被拒: 用户 ${user.username} 在房间 ${roomId} DB 无成员记录（socket.join 与 DB 写入不一致）`,
      );
      // 同时把客户端从 Socket.IO 房间踢出，避免下次再误判
      client.leave(roomSocketId);
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
    const data = client.data as WsSocketData | undefined;

    try {
      // 1. 将客户端加入 Socket.IO 房间（这只是在线状态的载体；已在该房间时是 no-op）
      await client.join(roomSocketId);
      // 2. 自维护房间列表，供 handleDisconnect 使用（client.rooms 在断开时恒为空）
      if (data && !data.rooms?.includes(roomSocketId)) {
        data.rooms = [...(data.rooms ?? []), roomSocketId];
      }

      // 3. 持久化成员关系（幂等：重复进入返回既有记录，不报错、不重置 joinedAt）
      //    created 表示本次是否真的新增了成员，决定要不要广播 member-joined
      const { created } = await this.chatService.joinRoom(roomId, user.sub, user.username);

      // 4. 获取房间成员列表（持久名册，与在线状态无关）
      const members = await this.chatService.getRoomMembers(roomId, user.sub);

      // 5. 获取最近 50 条历史消息
      const history = await this.chatService.getRecentMessages(roomId, 50);

      // 6. 先广播在线快照再发 room-joined：同一 socket 上 emit 有序，
      //    这样客户端在收到 room-joined 之前 onlineUserIds 已经就位，页头人数不会从 0 跳变
      await this.broadcastPresence(roomId);

      // 7. 向客户端发送加入成功确认，携带成员列表和历史消息
      client.emit('room-joined', {
        roomId,                 // 房间 ID
        members,                // 成员列表（持久成员）
        history,                // 历史消息列表
      });

      // 8. 仅当真的新增了成员关系才广播：重复进入房间不该让所有人的成员列表被反复刷
      if (created) {
        client.broadcast.to(roomSocketId).emit('member-joined', {
          userId: user.sub,           // 新加入的用户 ID
          username: user.username,    // 新加入的用户名
          roomId,                     // 房间 ID
        });
      }

      // 输出加入房间日志
      this.logger.log(`用户 ${user.username} 加入房间 ${roomId}`);
    } catch (err) {
      // 加入失败时向客户端发送错误信息，保留 service 抛出的真实状态码（房间不存在是 404）
      const status = typeof err?.getStatus === 'function' ? err.getStatus() : 500;
      client.emit('error', { code: status, msg: err.message });
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
    const data = client.data as WsSocketData | undefined;

    // 1. 将客户端从 Socket.IO 房间中移除（这只影响在线状态）
    client.leave(roomSocketId);
    // 2. 同步自维护的房间列表
    if (data) {
      data.rooms = (data.rooms ?? []).filter((r) => r !== roomSocketId);
    }
    // 3. **不删成员记录**：离开页面不等于退出房间。
    //    这里以前调 chatService.leaveRoom()（memberRepo.delete），是「进入房间必 403」的直接原因 ——
    //    用户每次退出页面都被删掉自己的成员资格，下次进入 loadHistory 必然被 assertUserInRoom 拦下。
    //    成员关系只能由 REST POST /chat/leave（removeMembership）或删除房间来终止。

    // 4. 广播在线快照（自己已 leave，不会被算进去）
    const onlineUserIds = await this.broadcastPresence(roomId, client.id);

    // 5. 多标签页友好：该用户还有别的 socket 在房间里时不广播「离开」
    if (!onlineUserIds.includes(user.sub)) {
      this.server.to(roomSocketId).emit('member-left', {
        userId: user.sub,           // 离开的用户 ID
        username: user.username,    // 离开的用户名
        roomId,                     // 房间 ID
      });
    }

    // 输出离开房间日志
    this.logger.log(`用户 ${user.username} 离开房间 ${roomId}`);
  }
}
