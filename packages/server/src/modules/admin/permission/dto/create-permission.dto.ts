// 引入 class-validator 校验装饰器
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
// 引入 Swagger 装饰器
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/**
 * 创建权限 DTO
 *
 * 权限码命名规范：`模块:动作`，例如 user:list / book:create / ai:chat
 */
export class CreatePermissionDto {
  @ApiProperty({ description: '权限编码（唯一）', example: 'audit:export' })
  @IsString()
  @IsNotEmpty({ message: '权限编码不能为空' })
  @MaxLength(100)
  code: string

  @ApiProperty({ description: '权限名称', example: '导出审计日志' })
  @IsString()
  @IsNotEmpty({ message: '权限名称不能为空' })
  @MaxLength(100)
  name: string

  @ApiProperty({ description: '所属模块', example: 'audit' })
  @IsString()
  @IsNotEmpty({ message: '所属模块不能为空' })
  @MaxLength(50)
  module: string

  @ApiPropertyOptional({ description: '权限描述' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string
}
