/**
 * 令牌版本号工具单元测试
 *
 * 这套规则被 JwtAuthGuard、ChatGateway、SessionService 三处共用，
 * 解析口径一旦分歧，表现是"吊销时灵时不灵"，因此逐条钉死行为。
 */

import { isTokenRevoked, parseTokenVersion } from './token-version.util'

describe('parseTokenVersion', () => {
  it('键不存在（null / undefined / 空串）一律视为 0', () => {
    expect(parseTokenVersion(null)).toBe(0)
    expect(parseTokenVersion(undefined)).toBe(0)
    expect(parseTokenVersion('')).toBe(0)
  })

  it('正常数字字符串应原样解析', () => {
    expect(parseTokenVersion('0')).toBe(0)
    expect(parseTokenVersion('1')).toBe(1)
    expect(parseTokenVersion('42')).toBe(42)
  })

  it('超出安全整数范围的大版本号不应变成 NaN', () => {
    // Redis INCR 理论上不会涨到这个量级，但解析不能因此崩掉
    expect(parseTokenVersion('9007199254740993')).toBe(9007199254740992)
  })

  it('负数视为 0（版本号只可能单调递增，负数说明被写脏了）', () => {
    expect(parseTokenVersion('-1')).toBe(0)
  })

  it('非数字内容视为 0', () => {
    expect(parseTokenVersion('abc')).toBe(0)
    expect(parseTokenVersion('{}')).toBe(0)
  })

  it('带后缀的数字按前缀解析（parseInt 语义，够用且不抛错）', () => {
    expect(parseTokenVersion('3abc')).toBe(3)
  })
})

describe('isTokenRevoked', () => {
  it('令牌版本等于当前版本 → 有效（刚签发的令牌）', () => {
    expect(isTokenRevoked(3, 3)).toBe(false)
  })

  it('令牌版本大于当前版本 → 有效（版本号被清过，不该误伤用户）', () => {
    expect(isTokenRevoked(5, 3)).toBe(false)
  })

  it('令牌版本小于当前版本 → 已吊销（签发于某次全量吊销之前）', () => {
    expect(isTokenRevoked(0, 1)).toBe(true)
    expect(isTokenRevoked(2, 3)).toBe(true)
  })

  it('当前版本为 0（从未全量吊销）→ 任何令牌都有效', () => {
    expect(isTokenRevoked(0, 0)).toBe(false)
  })

  it('旧令牌缺少 tokenVersion 字段 → 按 0 处理', () => {
    expect(isTokenRevoked(undefined, 1)).toBe(true)
    expect(isTokenRevoked(null, 1)).toBe(true)
    expect(isTokenRevoked(undefined, 0)).toBe(false)
  })

  it('payload 里是数字（JWT 签发时写的是 number）也能正确比较', () => {
    expect(isTokenRevoked(2, 3)).toBe(true)
    expect(isTokenRevoked(3, 3)).toBe(false)
  })

  it('payload 字段被写脏时按 0 处理，不会因 NaN 比较而误放行被踢的令牌', () => {
    // 注意：0 < 1 为真，即"版本号脏"的令牌在用户被踢过之后仍会被拒
    expect(isTokenRevoked('abc', 1)).toBe(true)
    expect(isTokenRevoked({}, 1)).toBe(true)
  })
})
