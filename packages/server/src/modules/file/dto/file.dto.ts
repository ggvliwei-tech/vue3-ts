/**
 * 文件上传响应 DTO
 * 定义文件上传成功后返回的数据结构
 */
import { ApiProperty } from '@nestjs/swagger';      // Swagger 文档装饰器

export class UploadResDto {                         // 文件上传响应数据传输对象
  @ApiProperty({ description: '文件访问完整地址' })  // Swagger 文档标注：文件访问 URL
  url!: string;

  @ApiProperty({ description: '文件原始名称' })      // Swagger 文档标注：用户上传时的原始文件名
  originalname!: string;

  @ApiProperty({ description: '存储文件名' })        // Swagger 文档标注：实际存储在磁盘的文件名（UUID + 扩展名）
  filename!: string;

  @ApiProperty({ description: '文件大小 byte' })     // Swagger 文档标注：文件大小，单位为字节
  size!: number;

  @ApiProperty({ description: 'MIME类型' })          // Swagger 文档标注：文件的 MIME 类型，如 image/png
  mimetype!: string;
}
