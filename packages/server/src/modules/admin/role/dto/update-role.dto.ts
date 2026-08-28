// 引入 class-validator 校验装饰器
import { IsOptional, IsString, MaxLength, IsInt, Min, Max } from 'class-validator'
// 引入 Swagger 装饰器
import { ApiPropertyOptional } from '@nestjs/swagger'

/**
 * 更新角色 DTO（所有字段可选）
 */
export class UpdateRoleDto {
  @ApiPropertyOptional({ description: '角色名称' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string

  @ApiPropertyOptional({ description: '角色描述' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string

  @ApiPropertyOptional({ description: '状态：1启用 0禁用' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  status?: number
}
