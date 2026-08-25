// 导入 NestJS 装饰器：Controller、Post、Body
import { Controller, Post, Body } from '@nestjs/common';
// 导入 Swagger 装饰器
import { ApiOperation, ApiTags } from '@nestjs/swagger';
// 导入短信服务
import { SmsService } from './sms.service';
// 导入发送验证码 DTO
import { SendCodeDto } from './dto/send-code.dto';

// Swagger 标签装饰器
@ApiTags('短信管理')
// 控制器装饰器：设置 /sms 为所有路由的公共前缀
@Controller('sms')
// 短信控制器类：处理短信相关 HTTP 请求
export class SmsController {
  // 构造函数注入短信服务
  constructor(private readonly smsService: SmsService) {}

  // POST 路由装饰器：注册 /sms/send-code 接口
  @Post('send-code')
  // Swagger 操作描述
  @ApiOperation({ summary: '发送短信验证码' })
  // 发送验证码接口处理函数
  async sendCode(@Body() dto: SendCodeDto) {
    // 调用服务层发送验证码方法
    return this.smsService.sendCode(dto.phone);
  }
}