/**
 * 短信相关 API 模块
 */

import { post } from '@project/shared/request'

/**
 * 发送短信验证码
 * @param phone - 手机号
 */
export function sendCode(phone: string) {
  return post<{ msg: string; mockCode?: string }>('/api/v1/sms/send-code', { phone })
}