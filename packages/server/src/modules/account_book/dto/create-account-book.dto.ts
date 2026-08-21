// 导入 class-validator 验证装饰器
import { IsNotEmpty, Length, IsUrl } from 'class-validator';
// 导入 Swagger API 属性装饰器，用于生成 API 文档
import { ApiProperty } from '@nestjs/swagger';

// 创建账本 DTO 类，定义新增账本时请求体的数据结构
export class CreateAccountBookDto {
  // Swagger 文档描述：网站名称
  @ApiProperty({ description: '网站名称' })
  // 验证：不能为空
  @IsNotEmpty({ message: '网站名称不能为空' })
  // 验证：字符串长度 1-100
  @Length(1, 100)
  websiteName: string;

  // Swagger 文档描述：网站地址，非必填
  @ApiProperty({ description: '网站地址', required: false })
  // 验证：必须是有效的 URL 格式
  @IsUrl({}, { message: '网址格式不正确' })
  websiteUrl?: string;

  // Swagger 文档描述：登录账号
  @ApiProperty({ description: '登录账号' })
  // 验证：不能为空
  @IsNotEmpty({ message: '登录账号不能为空' })
  loginAccount: string;

  // Swagger 文档描述：登录密码
  @ApiProperty({ description: '登录密码' })
  // 验证：不能为空
  @IsNotEmpty({ message: '登录密码不能为空' })
  loginPassword: string;
}
