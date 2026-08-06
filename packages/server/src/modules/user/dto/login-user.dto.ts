// IsNotEmpty 非空校验装饰器，确保字段不为空
import { IsNotEmpty } from 'class-validator';
// ApiProperty 用于 Swagger 文档生成字段描述
import { ApiProperty } from '@nestjs/swagger';

// 登录用户 DTO，定义登录接口请求体的数据结构
export class LoginUserDto {
  // Swagger 文档中显示的用户名描述
  @ApiProperty({ description: '用户名' })
  // 校验：用户名不能为空
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string;

  // Swagger 文档中显示的密码描述
  @ApiProperty({ description: '密码' })
  // 校验：密码不能为空
  @IsNotEmpty({ message: '密码不能为空' })
  password: string;
}
