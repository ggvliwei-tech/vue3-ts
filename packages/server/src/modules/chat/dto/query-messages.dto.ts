import { IsNumber, Min, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// 查询房间消息请求 DTO
export class QueryMessagesDto {
  // 房间 ID，必填，必须是数字
  @ApiProperty({ description: '房间ID' })
  @IsNumber({}, { message: '房间ID必须是数字' })
  @Type(() => Number)
  roomId: number;

  // 页码，选填，默认 1，最小 1
  @ApiProperty({ required: false, description: '页码' })
  @IsOptional()
  @IsNumber({}, { message: '页码必须是数字' })
  @Min(1)
  @Type(() => Number)
  page?: number;

  // 每页条数，选填，默认 50，最小 1
  @ApiProperty({ required: false, description: '每页条数' })
  @IsOptional()
  @IsNumber({}, { message: '每页条数必须是数字' })
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
