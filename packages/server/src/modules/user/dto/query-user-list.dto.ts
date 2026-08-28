/**
 * 用户列表查询 DTO（M5 + M7 + 增量：keyword/status 筛选）
 * GET /user 列表分页参数校验
 *
 * 字段：
 *  - page / pageSize：分页
 *  - keyword：用户名模糊匹配（不含手机号，避免 PII 暴露 + 列表语义以 username 为主）
 *  - status：精确匹配 1 正常 / 0 禁用；不传则查全部
 */
import {
  IsNumber,
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  Length,
} from 'class-validator'
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

  @ApiProperty({
    required: false,
    description: '用户名模糊匹配（LIKE %keyword%）',
  })
  @IsOptional()
  @IsString({ message: 'keyword 必须是字符串' })
  @Length(0, 50, { message: 'keyword 长度 0-50' })
  keyword?: string

  @ApiProperty({
    required: false,
    description: '用户状态：1 正常 / 0 禁用；不传查全部',
    enum: [0, 1],
  })
  @IsOptional()
  @IsInt({ message: 'status 必须是整数' })
  @Type(() => Number)
  status?: 0 | 1
}