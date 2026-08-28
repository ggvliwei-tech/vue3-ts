// 引入 class-validator 校验装饰器
import { IsNotEmpty, IsOptional, IsString, MaxLength, IsInt, Min, Max } from 'class-validator'
// 引入 Swagger 装饰器
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/**
 * 创建角色 DTO
 */
export class CreateRoleDto {
  @ApiProperty({ description: '角色编码（唯一）：admin/editor/user/自定义', example: 'auditor' })
  @IsString()
  @IsNotEmpty({ message: '角色编码不能为空' })
  @MaxLength(50)
  code: string

  @ApiProperty({ description: '角色名称', example: '审计员' })
  @IsString()
  @IsNotEmpty({ message: '角色名称不能为空' })
  @MaxLength(50)
  name: string

  @ApiPropertyOptional({ description: '角色描述' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string

  @ApiPropertyOptional({ description: '状态：1启用 0禁用', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  status?: number

  @ApiPropertyOptional({ description: '创建时绑定的权限码数组（可选）', example: ['user:list', 'audit:list'] })
  @IsOptional()
  @IsString({ each: true })
  permissionCodes?: string[]
}
