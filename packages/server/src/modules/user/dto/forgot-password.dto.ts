// IsNotEmpty 非空校验装饰器
import { IsNotEmpty, Matches, Length } from 'class-validator';
// ApiProperty 装饰器，用于 Swagger 文档
import { ApiProperty } from '@nestjs/swagger';

// 忘记密码 DTO，定义通过手机号重置密码接口的请求体数据结构
export class ForgotPasswordDto {
  // 手机号字段
  @ApiProperty({ description: '注册时使用的手机号' })
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  // 短信验证码字段
  @ApiProperty({ description: '短信验证码（6位数字）' })
  @IsNotEmpty({ message: '验证码不能为空' })
  @Length(6, 6, { message: '验证码为 6 位数字' })
  code: string;

  // 新密码字段
  @ApiProperty({ description: '新密码' })
  @IsNotEmpty({ message: '新密码不能为空' })
  @Length(6, 32, { message: '密码长度 6-32 位' })
  newPassword: string;
}