// IsOptional 可选校验装饰器：sessionId 不传表示踢该用户全部设备
import { IsOptional } from 'class-validator';
// IsString 字符串类型校验装饰器
import { IsString } from 'class-validator';
// MaxLength 长度上限校验装饰器
import { MaxLength } from 'class-validator';
// Matches 正则校验装饰器
import { Matches } from 'class-validator';
// ApiPropertyOptional 装饰器，为 Swagger 文档描述可选字段
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 强制下线（踢设备）请求体
 *
 * 为什么必须用 DTO 而不是内联类型：
 * 内联的 `@Body() body: { sessionId?: string }` 在运行时**没有元类型**，
 * ValidationPipe 据此认为无需校验，直接原样透传 —— 等于这个入参完全没有约束，
 * 再长的字符串也能进来。走 DTO 才让下面的装饰器真正生效。
 *
 * sessionId 的形态是会话 UUIDv4（见 session.service.ts），所以除了长度上限，
 * 还用正则把字符集一并收紧：这个值会拼进 Redis key，给它一个明确的形状
 * 比只限长度更稳妥。
 */
export class ForceKickDto {
  // 可选：不传 = 踢该用户全部设备
  @ApiPropertyOptional({
    description: '要踢下线的会话 ID；不传表示踢该用户全部设备',
  })
  // 允许显式传 undefined / null（等价于"不指定会话"）
  @IsOptional()
  // 类型必须是字符串
  @IsString({ message: 'sessionId 必须是字符串' })
  // 长度上限 36，正好容纳带连字符的 UUIDv4
  @MaxLength(36, { message: 'sessionId 长度不能超过 36' })
  // 只允许 UUID 字符集（hex + 连字符），避免任意字符串进入后续的 key 拼接
  @Matches(/^[0-9a-fA-F-]+$/, { message: 'sessionId 格式非法' })
  sessionId?: string;
}
