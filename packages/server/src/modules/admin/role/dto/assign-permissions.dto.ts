// 引入 class-validator 校验装饰器
import { ArrayUnique, IsArray, IsInt, IsString } from 'class-validator'
// 引入 Swagger 装饰器
import { ApiProperty } from '@nestjs/swagger'

/**
 * 给角色分配权限 DTO
 * - 全量替换：传 permissionIds 即覆盖该角色所有权限
 */
export class AssignPermissionsDto {
  @ApiProperty({ description: '权限 ID 数组（替换式赋值）', example: [1, 2, 5], type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  @ArrayUnique()
  permissionIds: number[]
}

/**
 * 给角色分配权限码 DTO（前端友好版本）
 */
export class AssignPermissionCodesDto {
  @ApiProperty({ description: '权限码数组（替换式赋值）', example: ['user:list', 'book:create'] })
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  codes: string[]
}
