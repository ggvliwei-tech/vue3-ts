/**
 * 公共知识库管理接口（管理端）
 *
 * 路由前缀是 admin/knowledge，但**归属 AiModule 而不是 AdminModule**：
 * 它消费的是 RagService，而 ai.module.ts 的注释明确了"四个服务都只在本模块内消费，
 * 无需 exports"。挂到 AdminModule 就得把 RagService 导出出去，等于为一个接口
 * 打破模块边界。权限码（ai:doc:manage，module='admin'）是独立于归属的，
 * 因此放在这里不会让 editor 之类的角色误拿到管理权限。
 *
 * 公共库 = 向量库里的 business_docs collection，**所有登录用户都能检索到**，
 * 所以写操作必须收敛到 ai:doc:manage 这一个权限码上。
 * 用户自己的资料走 AiController 的 /ai/upload/pdf + /ai/documents，
 * 那条路径写到 user_docs_{userId}，与本控制器完全隔离。
 */
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiConsumes, ApiOperation } from '@nestjs/swagger'
import { AiService } from './ai.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard'
import { Permissions } from '../../common/decorators/permissions.decorator'

// 守卫顺序与 AiController 一致：JwtAuthGuard 必须在 UserThrottlerGuard 之前，
// 后者按 req.user.id 计数，顺序颠倒会静默退化成按 IP 计数。
@UseGuards(JwtAuthGuard, PermissionsGuard, UserThrottlerGuard)
// 整个控制器只认这一个权限码：公共库是全站可见的知识源，不能放宽
@Permissions('ai:doc:manage')
@ApiBearerAuth()
@Controller('admin/knowledge')
export class AiDocAdminController {
  constructor(private readonly aiService: AiService) {}

  // POST /admin/knowledge/upload
  @Post('upload')
  @ApiOperation({ summary: '上传 PDF 到公共知识库（全站用户可检索）' })
  @ApiConsumes('multipart/form-data')
  // 与私有库上传同样的 20MB 上限；未指定 storage → memoryStorage，内容在 file.buffer
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
      // 同 AiController：不声明 utf8 时中文文件名会被 busboy 按 latin1 解码成乱码
      defParamCharset: 'utf8',
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File) {
    // 不带文件时 file 为 undefined，直接取 .buffer 会抛 TypeError → 500
    if (!file?.buffer?.length) {
      throw new BadRequestException('请选择要上传的 PDF 文件')
    }
    return this.aiService.uploadPdfToVector(file.buffer, file.originalname)
  }

  // GET /admin/knowledge/documents
  @Get('documents')
  @ApiOperation({ summary: '列出公共知识库文档' })
  listDocuments() {
    return this.aiService.listPublicDocs()
  }

  // POST /admin/knowledge/documents/:docId/delete
  @Post('documents/:docId/delete')
  @ApiOperation({ summary: '删除公共知识库文档' })
  async deleteDocument(@Param('docId') docId: string) {
    // 返回实际删除的切块数，0 表示该文档不存在
    const removed = await this.aiService.deletePublicDoc(docId)
    return { msg: '文档已删除', removed }
  }
}
