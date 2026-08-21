import { IsNotEmpty, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// 创建房间请求 DTO
export class CreateRoomDto {
  // 房间名称，不能为空，长度 1-100
  @ApiProperty({ description: '房间名称' })
  @IsNotEmpty({ message: '房间名称不能为空' })
  @Length(1, 100)
  name: string;
}
