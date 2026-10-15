import { getClientIp } from './client-ip.util'

/**
 * 这组用例钉住一条真实攻击路径：
 *
 * nginx 用 `$proxy_add_x_forwarded_for` 时，XFF 的值是「客户端提供的 + 真实来源」，
 * 真值在**最右边**。原实现取 `split(',')[0]`，拿到的是客户端编的那个 ——
 * 攻击者每次换一个假 IP 就换一个限流桶，登录爆破的 IP 限流完全失效。
 *
 * 所以下面最要紧的一条断言是：**函数绝不读 X-Forwarded-For 头本身**。
 */
describe('getClientIp', () => {
  /** 构造一个只带 ip / socket 的最小请求对象 */
  const req = (ip: string | undefined, remoteAddress?: string) =>
    ({ ip, socket: { remoteAddress } }) as never

  it('返回 Express 解析后的 req.ip（trust proxy 已由 main.ts 配置好）', () => {
    expect(getClientIp(req('127.0.0.1'))).toBe('127.0.0.1')
    expect(getClientIp(req('203.0.113.7'))).toBe('203.0.113.7')
  })

  it('IPv4-mapped IPv6 被规整成 IPv4（同一客户端不该落进两个限流桶）', () => {
    // 双栈监听的直连请求会带上 ::ffff: 前缀，而经 nginx 转发的同一客户端不带
    expect(getClientIp(req('::ffff:127.0.0.1'))).toBe('127.0.0.1')
    expect(getClientIp(req('::ffff:192.168.1.9'))).toBe('192.168.1.9')
  })

  it('真正的 IPv6 地址原样保留', () => {
    expect(getClientIp(req('2001:db8::1'))).toBe('2001:db8::1')
    expect(getClientIp(req('::1'))).toBe('::1')
  })

  it('req.ip 缺失时退回 socket.remoteAddress', () => {
    expect(getClientIp(req(undefined, '10.0.0.5'))).toBe('10.0.0.5')
    expect(getClientIp(req('', '::ffff:10.0.0.5'))).toBe('10.0.0.5')
  })

  it('两者都取不到时返回 unknown，而不是 undefined', () => {
    // 限流键里出现字符串 "undefined" 会让所有这类请求挤在同一个桶里
    expect(getClientIp(req(undefined, undefined))).toBe('unknown')
    expect(getClientIp(req(''))).toBe('unknown')
  })

  it('绝不读取 X-Forwarded-For 头（伪造该头不影响结果）', () => {
    const spoofed = {
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    } as never
    expect(getClientIp(spoofed)).toBe('127.0.0.1')
  })
})
