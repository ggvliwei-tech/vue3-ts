/**
 * WebSocket (Socket.IO) 客户端工具
 * 用于连接 server 端 /ws 命名空间，实现实时聊天功能
 *
 * Bug 修复要点：
 *  - 连接已建立时再次调用 connectWebSocket，必须**同步**触发 onConnect
 *    否则 ChatRoom 进入时如果 socket 已连接，会漏掉 join-room，send-msg 被服务端以
 *    "您不在该房间中" 403 拒绝。
 *  - 重连（'reconnect' 事件）后服务端 rooms 已被清空，需重新触发 join-room。
 *  - ChatRoom 卸载时同步移除所有事件监听，避免多次进入同一 ChatRoom 累积重复 handler
 *    导致重复 join / 重复收消息。
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
  onNewMessage?: (msg: WSMessage) => void                                             // 收到新消息事件（其他人发的）
  onMessageSent?: (msg: WSMessage) => void                                            // 自己消息发送成功事件
  onRoomJoined?: (data: { roomId: number; members: any[]; history: WSMessage[] }) => void  // 加入房间成功回调
  onMemberJoined?: (data: { userId: number; username: string; roomId: number }) => void    // 其他成员加入回调
  onMemberLeft?: (data: { userId: number; username: string; roomId: number }) => void      // 其他成员离开回调
}

// Socket.IO 单例实例
let socket: Socket | null = null

/**
 * 解除本调用绑定的全部事件监听（仅清理 socket.io 事件，不 disconnect socket）
 * 用于 ChatRoom 卸载时清理 handler，避免累积
 */
export function clearWebSocketHandlers(): void {
  if (!socket) return
  socket.removeAllListeners()
}

/**
 * 建立 WebSocket 连接
 *
 * 关键不变量：调用方传入的 handlers.onConnect **必然**会在以下时机被调用：
 *  1. 全新 socket 建立成功（'connect' 事件）
 *  2. 已有 socket 仍处于 connected 状态（同步立即触发，避免漏掉 join-room）
 *  3. socket 自动重连成功（'reconnect' 事件） —— 因为服务端在 disconnect 时会清空 rooms
 *
 * @param handlers - 事件回调函数集合
 * @returns Socket 实例
 */
export function connectWebSocket(handlers: WSEventHandlers = {}): Socket {
  // 从 localStorage 获取 JWT token
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : ''
  // 未登录则抛出错误
  if (!token) throw new Error('未登录')

  // 如果有旧 socket 且仍 connected：必须重新绑定本调用方的 handlers（否则 onConnect 漏触发）
  // 同步立即调用 onConnect，确保本调用方执行 join-room 等连接后置动作
  if (socket?.connected) {
    bindHandlers(socket, handlers)
    // 同步触发：socket 已连接，新 handler 不会再被 'connect' 事件唤醒，必须手动 invoke
    handlers.onConnect?.()
    return socket
  }

  // 旧 socket 存在但已 disconnected（断网重连失败后会停在 disconnected）
  // 或者完全没有 socket —— 新建一个
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }

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

  // 绑定事件（含 onConnect 同步触发语义）
  bindHandlers(socket, handlers)

  return socket
}

/**
 * 在已有 socket 上绑定一组 handlers
 * - 'connect' / 'reconnect'：调用 onConnect（前者是首次连接，后者是断线恢复）
 * - 'disconnect'：调用 onDisconnect
 * - 'error'：调用 onError
 * - 其余 server → client 事件转发到对应 handler
 */
function bindHandlers(socket: Socket, handlers: WSEventHandlers): void {
  // 先解绑，避免 socket 单例上累积多组 handler
  socket.removeAllListeners()

  // 首次连接 / 重连成功都视为"connected"，都会触发 onConnect 回调
  // （'connect' 是首次 / 手动重连触发；'reconnect' 是 socket.io-client 自动重连触发）
  socket.on('connect', () => handlers.onConnect?.())
  socket.on('reconnect', () => handlers.onConnect?.())
  // 断开连接回调
  socket.on('disconnect', (reason) => handlers.onDisconnect?.(reason))
  // 服务端错误回调
  socket.on('error', (error) => handlers.onError?.(error))
  // 收到新消息事件（server 广播的 new-msg）
  socket.on('new-msg', (msg: WSMessage) => handlers.onNewMessage?.(msg))
  // 自己消息发送成功事件（server 确认的 msg-sent）
  socket.on('msg-sent', (msg: WSMessage) => handlers.onMessageSent?.(msg))
  // 加入房间成功事件（server 返回的 room-joined）
  socket.on('room-joined', (data) => handlers.onRoomJoined?.(data))
  // 其他成员加入事件（server 广播的 member-joined）
  socket.on('member-joined', (data) => handlers.onMemberJoined?.(data))
  // 其他成员离开事件（server 广播的 member-left）
  socket.on('member-left', (data) => handlers.onMemberLeft?.(data))
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