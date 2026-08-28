/**
 * 房间列表查询 DTO（M5 补齐）
 * 给 GET /chat/rooms 提供参数校验 + 自动转换
 */
import { IsNumber, IsOptional, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty } from '@nestjs/swagger'

export class QueryRoomListDto {
  @ApiProperty({ required: false, description: '页码，从 1 开始', default: 1 })
  @IsOptional()
  @IsNumber({}, { message: 'page 必须是数字' })
  @Type(() => Number)
  @Min(1)
  @Max(10_000)
  page?: number

  @ApiProperty({ required: false, description: '每页条数，1-100', default: 20 })
  @IsOptional()
  @IsNumber({}, { message: 'limit 必须是数字' })
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number
}
