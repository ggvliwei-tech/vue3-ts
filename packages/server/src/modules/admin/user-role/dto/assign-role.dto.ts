// 引入 class-validator 校验装饰器
import { ArrayUnique, IsArray, IsInt, IsPositive } from 'class-validator'
// 引入 Swagger 装饰器
import { ApiProperty } from '@nestjs/swagger'

/**
 * 给用户分配角色 DTO
 * - 全量替换：传 roleIds 即覆盖该用户所有角色
 */
export class AssignRolesDto {
  @ApiProperty({ description: '角色 ID 数组（替换式赋值）', example: [1, 3], type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  @IsPositive({ each: true })
  @ArrayUnique()
  roleIds: number[]
}
