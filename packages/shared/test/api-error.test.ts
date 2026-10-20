/**
 * ApiError 分类单元测试
 *
 * 这组用例钉住的是「刷新失败时到底该不该把用户踢下线」这个判断的唯一输入。
 * 修复前 request.ts 抛裸 Error，网络断开 / 5xx / 401 三种情况在
 * token-refresh 里完全无法区分，于是统统走了登出流程 ——
 * 刷新时网断一下，用户的本地登录态就被清掉并跳回登录页，而服务端的
 * refresh token 还好好的。所以 kind 的正确性直接决定用户会不会被误踢。
 */
import { describe, expect, it } from 'vitest'
import { ApiError, isApiError } from '../src/api-error'

describe('ApiError', () => {
  it('保留 message 且是真正的 Error（向后兼容既有 err.message 调用点）', () => {
    const err = new ApiError('登录已过期', { kind: 'http', status: 401 })

    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('登录已过期')
    expect(err.name).toBe('ApiError')
    // 栈必须存在：日志与 Sentry 类上报都依赖它
    expect(typeof err.stack).toBe('string')
  })

  it.each([
    ['network', undefined, true],
    ['http', 500, true],
    ['http', 502, true],
    ['http', 503, true],
    ['http', 401, false],
    ['http', 403, false],
    ['http', 400, false],
    ['http', 409, false],
    ['business', undefined, false],
  ] as const)('kind=%s status=%s 时 retryable=%s', (kind, status, expected) => {
    const err = new ApiError('x', { kind, status })
    expect(err.retryable).toBe(expected)
  })

  it('business 类错误带服务端业务码', () => {
    const err = new ApiError('权限不足', { kind: 'business', status: 200, code: 403 })

    expect(err.kind).toBe('business')
    expect(err.code).toBe(403)
    // HTTP 层是 200，但业务被拒 —— 它不该被当成可重试的网络问题
    expect(err.retryable).toBe(false)
  })

  it('isApiError 能识别 ApiError 并拒绝其他抛出值', () => {
    expect(isApiError(new ApiError('x', { kind: 'network' }))).toBe(true)
    // 后端 / 第三方库抛的普通 Error、以及非 Error 抛出值都不能被误认
    expect(isApiError(new Error('x'))).toBe(false)
    expect(isApiError(undefined)).toBe(false)
    expect(isApiError('字符串错误')).toBe(false)
  })
})
