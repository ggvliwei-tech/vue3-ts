import { Length, IsUrl, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateAccountBookDto {
  @ApiProperty({ description: '网站名称', required: false })
  @IsOptional()
  @Length(1, 100)
  websiteName?: string;

  @ApiProperty({ description: '网站地址', required: false })
  @IsOptional()
  @IsUrl()
  websiteUrl?: string;

  @ApiProperty({ description: '登录账号', required: false })
  @IsOptional()
  loginAccount?: string;

  @ApiProperty({ description: '登录密码', required: false })
  @IsOptional()
  loginPassword?: string;
}
