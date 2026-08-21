// 导入 class-validator 验证装饰器
import { Length, IsUrl, IsOptional } from 'class-validator';
// 导入 Swagger API 属性装饰器，用于生成 API 文档
import { ApiProperty } from '@nestjs/swagger';

// 更新账本 DTO 类，定义修改账本时请求体的数据结构（所有字段可选）
export class UpdateAccountBookDto {
  // Swagger 文档描述：网站名称，非必填
  @ApiProperty({ description: '网站名称', required: false })
  // 验证：该字段为可选字段
  @IsOptional()
  // 验证：如果提供，字符串长度 1-100
  @Length(1, 100)
  websiteName?: string;

  // Swagger 文档描述：网站地址，非必填
  @ApiProperty({ description: '网站地址', required: false })
  // 验证：该字段为可选字段
  @IsOptional()
  // 验证：如果提供，必须是有效的 URL 格式
  @IsUrl()
  websiteUrl?: string;

  // Swagger 文档描述：登录账号，非必填
  @ApiProperty({ description: '登录账号', required: false })
  // 验证：该字段为可选字段
  @IsOptional()
  loginAccount?: string;

  // Swagger 文档描述：登录密码，非必填
  @ApiProperty({ description: '登录密码', required: false })
  // 验证：该字段为可选字段
  @IsOptional()
  loginPassword?: string;
}
