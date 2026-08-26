// 导入 NestJS 的 SetMetadata 用于自定义元数据
import { SetMetadata } from '@nestjs/common'

// 定义元数据 key：true 表示该接口不需要鉴权
export const IS_PUBLIC_KEY = 'isPublic'

/**
 * 公开装饰器：标记接口为公开访问，无需登录或权限校验
 * 通常用于全局守卫下排除白名单接口（如登录、注册）
 * @example
 *   @Public()
 *   @Post('login')
 *   login() { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
