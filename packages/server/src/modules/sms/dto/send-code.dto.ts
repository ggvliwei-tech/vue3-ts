// IsNotEmpty 非空校验装饰器
import { IsNotEmpty, Matches } from 'class-validator';
// ApiProperty 装饰器，用于 Swagger 文档
import { ApiProperty } from '@nestjs/swagger';

// 发送验证码 DTO，定义发送短信验证码接口请求体的数据结构和校验规则
export class SendCodeDto {
  // ApiProperty 装饰器为 Swagger 文档提供手机号字段描述
  @ApiProperty({ description: '手机号' })
  // IsNotEmpty 装饰器校验手机号不能为空
  @IsNotEmpty({ message: '手机号不能为空' })
  // Matches 装饰器校验手机号格式为中国大陆 11 位手机号
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;
}