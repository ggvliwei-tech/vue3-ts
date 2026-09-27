// 导入 class-validator 验证装饰器
import { IsNotEmpty, IsOptional, Length, IsUrl } from 'class-validator';
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
  // 必须显式声明 @IsOptional()，否则 class-validator 会对 undefined 也跑校验：
  // IsUrl 对非字符串返回 false（不抛错），于是「不传这个字段」会被判成
  // 「网址格式不正确」，用户看到一条驴唇不对马嘴的 400。
  @IsOptional()
  // 验证：填了就必须是有效的 URL 格式
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
