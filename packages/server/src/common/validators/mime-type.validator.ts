// 导入文件验证器基类
import { FileValidator } from '@nestjs/common';
// 导入 Express 类型，用于 Multer 文件对象
import { Express } from 'express';

// 定义文件类型验证器的配置选项接口
export interface FileTypeValidatorOptions {
  fileType: RegExp | string; // 允许的文件类型，支持正则表达式或字符串
}

// 继承 FileValidator 的自定义文件类型验证器
// 基于 multer 提供的 file.mimetype 进行验证，不依赖 file.buffer
export class MimeTypeValidator extends FileValidator<FileTypeValidatorOptions, Express.Multer.File> {
  // 构建验证失败时的错误消息
  buildErrorMessage(): string {
    // 返回包含期望文件类型的格式化错误消息
    return `Validation failed (file type does not match; expected type is ${this.validationOptions.fileType})`;
  }

  // 验证文件是否有效，返回布尔值
  isValid(file?: Express.Multer.File): boolean {
    // 如果文件不存在，返回 false
    if (!file) return false;

    // 获取配置中允许的文件类型
    const { fileType } = this.validationOptions;
    // 获取文件的 MIME 类型，如果为空则使用空字符串
    const mimetype = file.mimetype || '';

    // 如果 fileType 是正则表达式，使用正则匹配
    if (fileType instanceof RegExp) {
      return fileType.test(mimetype);
    }

    // 否则进行精确字符串匹配
    return mimetype === fileType;
  }
}
