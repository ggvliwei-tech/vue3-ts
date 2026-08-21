import { IsNotEmpty, IsNumber, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// 发送消息请求 DTO（用于 WebSocket 消息校验）
export class SendMessageDto {
  // 房间 ID，不能为空，必须是数字
  @ApiProperty({ description: '房间ID' })
  @IsNotEmpty({ message: '房间ID不能为空' })
  @IsNumber({}, { message: '房间ID必须是数字' })
  roomId: number;

  // 消息内容，不能为空，长度 1-2000
  @ApiProperty({ description: '消息内容' })
  @IsNotEmpty({ message: '消息内容不能为空' })
  @Length(1, 2000)
  content: string;
}
