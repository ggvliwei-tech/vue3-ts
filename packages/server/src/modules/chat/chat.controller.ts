// 导入 NestJS 核心装饰器：Controller、Post、Get、Body、Query、UseGuards、Request
import { Controller, Post, Get, Body, Query, UseGuards, Request } from '@nestjs/common';
// 导入 JWT 认证守卫
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
// 导入 Swagger 文档装饰器
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
// 导入聊天服务
import { ChatService } from './chat.service';
// 导入 DTO 类
import { CreateRoomDto } from './dto/create-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';
import { QueryMessagesDto } from './dto/query-messages.dto';

// Swagger 标签装饰器：在文档中归类为"聊天室"
@ApiTags('聊天室')
// Swagger Bearer 认证装饰器：显示 token 输入框
@ApiBearerAuth()
// JWT 认证守卫：所有接口需登录
@UseGuards(JwtAuthGuard)
// 控制器装饰器：设置 chat 为路由前缀（全局前缀 api/v1 在 main.ts 配置）
@Controller('chat')
// 聊天控制器类：处理所有聊天室 REST API 请求
// 注意：返回值会被全局 TransformInterceptor 统一包装为 { code: 0, msg: '请求成功', data: xxx }
// 所以 controller 只需返回原始数据即可，不需要手动封装
export class ChatController {
  // 构造函数注入聊天服务
  constructor(private readonly chatService: ChatService) {}

  // POST /chat/room — 创建房间
  @Post('room')
  @ApiOperation({ summary: '创建聊天房间' })
  async createRoom(@Body() dto: CreateRoomDto, @Request() req) {
    // 调用服务创建房间，传入创建者信息
    // TransformInterceptor 会自动包装为 { code: 0, msg: '请求成功', data: room }
    return this.chatService.createRoom(dto, req.user.sub, req.user.username);
  }

  // GET /chat/rooms — 获取房间列表（分页）
  @Get('rooms')
  @ApiOperation({ summary: '获取房间列表' })
  async getRoomList(@Query('page') page = 1, @Query('limit') limit = 20) {
    // 调用服务获取分页房间列表
    return this.chatService.getRoomList(Number(page), Number(limit));
  }

  // GET /chat/my-rooms — 获取我加入的房间
  @Get('my-rooms')
  @ApiOperation({ summary: '获取我加入的房间' })
  async getMyRooms(@Request() req) {
    // 调用服务获取当前用户的房间列表
    return this.chatService.getUserRooms(req.user.sub);
  }

  // POST /chat/join — 加入房间
  @Post('join')
  @ApiOperation({ summary: '加入聊天房间' })
  async joinRoom(@Body() dto: JoinRoomDto, @Request() req) {
    // 调用服务加入房间
    return this.chatService.joinRoom(dto.roomId, req.user.sub, req.user.username);
  }

  // POST /chat/leave — 离开房间
  @Post('leave')
  @ApiOperation({ summary: '离开聊天房间' })
  async leaveRoom(@Body() dto: JoinRoomDto, @Request() req) {
    // 调用服务离开房间
    await this.chatService.leaveRoom(dto.roomId, req.user.sub);
    // 返回成功标识
    return { success: true };
  }

  // GET /chat/members — 获取房间成员列表
  @Get('members')
  @ApiOperation({ summary: '获取房间成员列表' })
  async getMembers(@Query('roomId') roomId: number) {
    // 调用服务获取成员列表
    return this.chatService.getRoomMembers(Number(roomId));
  }

  // GET /chat/messages — 获取房间历史消息
  @Get('messages')
  @ApiOperation({ summary: '获取房间历史消息' })
  async getMessages(@Query() dto: QueryMessagesDto) {
    // 调用服务获取分页消息列表
    return this.chatService.getMessages(dto);
  }

  // GET /chat/room/:id — 获取房间详情
  @Get('room/:id')
  @ApiOperation({ summary: '获取房间详情' })
  async getRoomDetail(@Query('id') id: number) {
    // 调用服务获取房间详情
    return this.chatService.getRoomById(Number(id));
  }

  // POST /chat/room/:id/delete — 删除房间
  @Post('room/:id/delete')
  @ApiOperation({ summary: '删除房间' })
  async deleteRoom(@Query('id') id: number) {
    // 调用服务删除房间
    await this.chatService.deleteRoom(Number(id));
    // 返回成功标识
    return { success: true };
  }
}
