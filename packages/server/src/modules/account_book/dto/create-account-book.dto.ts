import { IsNotEmpty, Length, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAccountBookDto {
  @ApiProperty({ description: '网站名称' })
  @IsNotEmpty({ message: '网站名称不能为空' })
  @Length(1, 100)
  websiteName: string;

  @ApiProperty({ description: '网站地址', required: false })
  @IsUrl({}, { message: '网址格式不正确' })
  websiteUrl?: string;

  @ApiProperty({ description: '登录账号' })
  @IsNotEmpty({ message: '登录账号不能为空' })
  loginAccount: string;

  @ApiProperty({ description: '登录密码' })
  @IsNotEmpty({ message: '登录密码不能为空' })
  loginPassword: string;
}
