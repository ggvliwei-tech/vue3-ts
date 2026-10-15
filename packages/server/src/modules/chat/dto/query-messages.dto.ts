import { IsNumber, Min, Max, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// 查询房间消息请求 DTO
// 上限与同目录的 QueryRoomListDto 保持一致（page ≤ 10000、limit ≤ 100）。
// 上限不能省：此前只有 @Min(1)，`?limit=999999` 会把整个房间历史一次读进 Node 内存，
// `?page=1000000` 则生成 OFFSET 50000000 —— MySQL 得先扫掉 5000 万行索引项才返回。
// 这是全项目唯一一个没有分页上限的列表接口，其余入口要么有 @Max，要么走 parsePositiveInt。
export class QueryMessagesDto {
  // 房间 ID，必填，必须是数字
  @ApiProperty({ description: '房间ID' })
  @IsNumber({}, { message: '房间ID必须是数字' })
  @Type(() => Number)
  roomId: number;

  // 页码，选填，默认 1，范围 1-10000
  @ApiProperty({ required: false, description: '页码，从 1 开始', default: 1 })
  @IsOptional()
  @IsNumber({}, { message: '页码必须是数字' })
  @Min(1, { message: '页码不能小于 1' })
  @Max(10_000, { message: '页码不能超过 10000' })
  @Type(() => Number)
  page?: number;

  // 每页条数，选填，默认 50，范围 1-100
  @ApiProperty({ required: false, description: '每页条数，1-100', default: 50 })
  @IsOptional()
  @IsNumber({}, { message: '每页条数必须是数字' })
  @Min(1, { message: '每页条数不能小于 1' })
  @Max(100, { message: '每页条数不能超过 100' })
  @Type(() => Number)
  limit?: number;
}
