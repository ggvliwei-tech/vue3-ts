import { IsNotEmpty, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// 加入房间请求 DTO
export class JoinRoomDto {
  // 房间 ID，不能为空，必须是数字
  @ApiProperty({ description: '房间ID' })
  @IsNotEmpty({ message: '房间ID不能为空' })
  @IsNumber({}, { message: '房间ID必须是数字' })
  roomId: number;
}
