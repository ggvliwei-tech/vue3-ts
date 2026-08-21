/**
 * WebSocket (Socket.IO) 客户端工具
 * 用于连接 server 端 /ws 命名空间，实现实时聊天功能
 */

// 导入 Socket.IO 客户端库的 io 工厂函数和 Socket 类型
import { io, Socket } from 'socket.io-client'

// 定义 WebSocket 消息接口
export interface WSMessage {
  id: number                    // 消息 ID
  roomId: number                // 房间 ID
  senderId: number              // 发送者用户 ID
  senderName: string            // 发送者用户名
  content: string               // 消息内容
  createdAt: number             // 发送时间戳
}

// 定义 WebSocket 事件回调函数接口
export interface WSEventHandlers {
  onConnect?: () => void                                                              // 连接成功回调
  onDisconnect?: (reason: string) => void                                             // 断开连接回调
  onError?: (error: { code: number; msg: string }) => void                            // 错误回调
  onNewMessage?: (msg: WSMessage) => void                                             // 收到新消息回调（其他人发的）
  onMessageSent?: (msg: WSMessage) => void                                            // 自己消息发送成功回调
  onRoomJoined?: (data: { roomId: number; members: any[]; history: WSMessage[] }) => void  // 加入房间成功回调
  onMemberJoined?: (data: { userId: number; username: string; roomId: number }) => void    // 其他成员加入回调
  onMemberLeft?: (data: { userId: number; username: string; roomId: number }) => void      // 其他成员离开回调
}

// Socket.IO 单例实例
let socket: Socket | null = null

/**
 * 建立 WebSocket 连接
 * @param handlers - 事件回调函数集合
 * @returns Socket 实例
 */
export function connectWebSocket(handlers: WSEventHandlers = {}): Socket {
  // 从 localStorage 获取 JWT token
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : ''
  // 未登录则抛出错误
  if (!token) throw new Error('未登录')
  // 如果已连接则直接返回现有实例
  if (socket?.connected) return socket
  // 如果有旧实例则先断开
  if (socket) socket.disconnect()

  // 从环境变量获取 API 地址，将 http/https 转为 ws/wss
  const baseURL = (import.meta as any).env?.VITE_API_BASE_URL ?? ''
  const wsUrl = baseURL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')

  // 创建 Socket.IO 连接
  socket = io(`${wsUrl}/ws`, {
    // 认证信息：携带 Bearer token
    auth: { token: `Bearer ${token}` },
    // 传输方式：优先 WebSocket，降级为 HTTP 长轮询
    transports: ['websocket', 'polling'],
    // 自动重连配置
    reconnection: true,             // 启用自动重连
    reconnectionDelay: 1000,        // 首次重连延迟 1 秒
    reconnectionAttempts: 5,        // 最多重连 5 次
  })

  // 绑定连接成功事件
  socket.on('connect', () => handlers.onConnect?.())
  // 绑定断开连接事件
  socket.on('disconnect', (reason) => handlers.onDisconnect?.(reason))
  // 绑定服务端错误事件
  socket.on('error', (error) => handlers.onError?.(error))
  // 绑定收到新消息事件（server 广播的 new-msg）
  socket.on('new-msg', (msg: WSMessage) => handlers.onNewMessage?.(msg))
  // 绑定自己消息发送成功事件（server 确认的 msg-sent）
  socket.on('msg-sent', (msg: WSMessage) => handlers.onMessageSent?.(msg))
  // 绑定加入房间成功事件（server 返回的 room-joined）
  socket.on('room-joined', (data) => handlers.onRoomJoined?.(data))
  // 绑定其他成员加入事件（server 广播的 member-joined）
  socket.on('member-joined', (data) => handlers.onMemberJoined?.(data))
  // 绑定其他成员离开事件（server 广播的 member-left）
  socket.on('member-left', (data) => handlers.onMemberLeft?.(data))

  // 返回 Socket 实例
  return socket
}

/**
 * 获取当前 Socket 实例
 * @returns Socket 实例或 null
 */
export function getSocket(): Socket | null {
  return socket
}

/**
 * 断开 WebSocket 连接
 */
export function disconnectWebSocket() {
  if (socket) {
    socket.disconnect()    // 断开连接
    socket = null          // 清空引用
  }
}

/**
 * 发送聊天消息到指定房间
 * @param roomId - 房间 ID
 * @param content - 消息内容
 */
export function sendRoomMessage(roomId: number, content: string) {
  // emit 'send-msg' 事件，携带 roomId 和 content（server 端会做 DTO 校验）
  socket?.emit('send-msg', { roomId, content })
}

/**
 * 加入指定房间
 * @param roomId - 房间 ID
 */
export function joinRoom(roomId: number) {
  // emit 'join-room' 事件，携带 roomId
  socket?.emit('join-room', { roomId })
}

/**
 * 离开指定房间
 * @param roomId - 房间 ID
 */
export function leaveRoom(roomId: number) {
  // emit 'leave-room' 事件，携带 roomId
  socket?.emit('leave-room', { roomId })
}
