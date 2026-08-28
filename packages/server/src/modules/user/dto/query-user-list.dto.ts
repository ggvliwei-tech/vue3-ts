/**
 * 用户列表查询 DTO（M5 + M7）
 * GET /user 列表分页参数校验
 */
import { IsNumber, IsOptional, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty } from '@nestjs/swagger'

export class QueryUserListDto {
  @ApiProperty({ required: false, description: '页码，从 1 开始', default: 1 })
  @IsOptional()
  @IsNumber({}, { message: 'page 必须是数字' })
  @Type(() => Number)
  @Min(1)
  page?: number

  @ApiProperty({ required: false, description: '每页条数，1-100', default: 20 })
  @IsOptional()
  @IsNumber({}, { message: 'pageSize 必须是数字' })
  @Type(() => Number)
  @Min(1)
  @Max(100)
  pageSize?: number
}
