// IsNotEmpty 非空校验装饰器，确保字段值不为空、undefined 或空字符串
import { IsNotEmpty } from 'class-validator';
// ApiProperty 装饰器，用于 Swagger 文档生成，描述字段信息和验证规则
import { ApiProperty } from '@nestjs/swagger';

// LoginUserDto 登录用户数据传输对象，定义登录接口请求体的数据结构和校验规则
export class LoginUserDto {
  // ApiProperty 装饰器为 Swagger 文档提供用户名字段描述
  @ApiProperty({ description: '用户名' })
  // IsNotEmpty 装饰器校验用户名不能为空，为空时返回指定错误消息
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string;

  // ApiProperty 装饰器为 Swagger 文档提供密码字段描述
  @ApiProperty({ description: '密码' })
  // IsNotEmpty 装饰器校验密码不能为空，为空时返回指定错误消息
  @IsNotEmpty({ message: '密码不能为空' })
  password: string;
}
