/**
 * 聊天室相关 API 模块
 */

// 从共享请求模块中导入 get 和 post 方法
import { get, post } from '@project/shared/request'

// 定义聊天房间接口
export interface ChatRoom {
  id: number              // 房间 ID
  name: string            // 房间名称
  creatorId: number       // 创建人 ID
  createdAt: number       // 创建时间戳
}

// 定义聊天房间成员接口
export interface ChatMember {
  id: number              // 成员记录 ID
  roomId: number          // 房间 ID
  userId: number          // 用户 ID
  username: string        // 用户名
  joinedAt: number        // 加入时间戳
}

// 定义聊天消息接口
export interface ChatMessage {
  id: number              // 消息 ID
  roomId: number          // 房间 ID
  senderId: number        // 发送者 ID
  senderName: string      // 发送者用户名
  content: string         // 消息内容
  createdAt: number       // 发送时间戳
}

// 定义分页结果接口（复用项目通用模式）
export interface PaginatedResult<T> {
  list: T[]               // 数据列表
  total: number           // 总数
  page: number            // 当前页
  limit: number           // 每页条数
}

/**
 * 创建聊天房间
 * @param data - 房间名称
 */
export function createRoom(data: { name: string }) {
  return post<ChatRoom>('/api/v1/chat/room', data)
}

/**
 * 获取房间列表（分页）
 * @param page - 页码
 * @param limit - 每页条数
 */
export function getRoomList(page = 1, limit = 20) {
  return get<PaginatedResult<ChatRoom>>(`/api/v1/chat/rooms?page=${page}&limit=${limit}`)
}

/**
 * 获取我加入的房间列表
 */
export function getMyRooms() {
  return get<ChatRoom[]>('/api/v1/chat/my-rooms')
}

/**
 * 加入聊天房间
 * @param data - 房间 ID
 */
export function joinRoomApi(data: { roomId: number }) {
  return post<ChatMember>('/api/v1/chat/join', data)
}

/**
 * 离开聊天房间
 * @param data - 房间 ID
 */
export function leaveRoomApi(data: { roomId: number }) {
  return post('/api/v1/chat/leave', data)
}

/**
 * 获取房间成员列表
 * @param roomId - 房间 ID
 */
export function getRoomMembers(roomId: number) {
  return get<ChatMember[]>(`/api/v1/chat/members?roomId=${roomId}`)
}

/**
 * 获取房间历史消息（分页）
 * @param roomId - 房间 ID
 * @param page - 页码
 * @param limit - 每页条数
 */
export function getRoomMessages(roomId: number, page = 1, limit = 50) {
  return get<PaginatedResult<ChatMessage>>(`/api/v1/chat/messages?roomId=${roomId}&page=${page}&limit=${limit}`)
}

/**
 * 获取房间详情
 * @param id - 房间 ID
 */
export function getRoomDetail(id: number) {
  return get<ChatRoom>(`/api/v1/chat/room/${id}`)
}

/**
 * 删除房间
 * @param id - 房间 ID
 */
export function deleteRoom(id: number) {
  return post(`/api/v1/chat/room/${id}/delete`)
}
