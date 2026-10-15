/**
 * maskPhone 单元测试
 *
 * 这些断言钉住的是「审计日志里不出现完整手机号」这条不变量。
 * 一旦有人把实现改回原样返回，业务代码不会报错、类型也不会变 ——
 * 只有这里会红。
 */
import { maskPhone } from './mask.util'

describe('maskPhone', () => {
  it('保留前 3 位与后 4 位，中间打码', () => {
    expect(maskPhone('13800138000')).toBe('138****8000')
  })

  it('掩码结果里不包含中间的号码段', () => {
    // 直接断言"原串不是结果"太弱（138****8000 !== 13800138000 必然成立，
    // 但一个只保留首位的实现也能通过）。真正要钉的是中间四位不能泄漏。
    const result = maskPhone('13912345678')
    expect(result).not.toContain('1234')
    expect(result.startsWith('139')).toBe(true)
    expect(result.endsWith('5678')).toBe(true)
  })

  it('非 11 位手机号原样返回，不做猜测式截断', () => {
    expect(maskPhone('1380013800')).toBe('1380013800')
    expect(maskPhone('')).toBe('')
    expect(maskPhone('alice')).toBe('alice')
  })

  it('号段不合法的 11 位数字也不脱敏（避免把非手机号的值改形）', () => {
    expect(maskPhone('23800138000')).toBe('23800138000')
  })

  it('传入 null/undefined 时不会抛出', () => {
    expect(maskPhone(undefined as unknown as string)).toBe('')
    expect(maskPhone(null as unknown as string)).toBe('')
  })
})
