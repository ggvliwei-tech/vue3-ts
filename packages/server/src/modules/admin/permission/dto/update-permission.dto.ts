// 引入 class-validator 校验装饰器
import { IsOptional, IsString, MaxLength } from 'class-validator'
// 引入 Swagger 装饰器
import { ApiPropertyOptional } from '@nestjs/swagger'

/**
 * 更新权限 DTO
 */
export class UpdatePermissionDto {
  @ApiPropertyOptional({ description: '权限名称' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string

  @ApiPropertyOptional({ description: '所属模块' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  module?: string

  @ApiPropertyOptional({ description: '权限描述' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string
}
