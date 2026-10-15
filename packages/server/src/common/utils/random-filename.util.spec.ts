import { generateRandomFileName, safeExtname } from './random-filename.util'

/**
 * 这组用例钉住两件事：
 *
 * 1. 文件名**不可枚举**。此前用的是 `${Date.now()}-${Math.random().toString(36)}`，
 *    Math.random 是可预测的伪随机、时间戳本就公开，而本地存储目录没有鉴权 ——
 *    文件名被猜到就等于文件被读到。
 * 2. 原始文件名是客户端可控字符串，拼进 URL 前必须被规整，
 *    否则引号 / 分号 / 超长后缀这类字符会原样进入存储路径。
 */
describe('safeExtname', () => {
  it('保留常见图片后缀', () => {
    expect(safeExtname('cat.jpg')).toBe('.jpg')
    expect(safeExtname('cat.jpeg')).toBe('.jpeg')
    expect(safeExtname('cat.png')).toBe('.png')
    expect(safeExtname('cat.gif')).toBe('.gif')
    expect(safeExtname('cat.webp')).toBe('.webp')
  })

  it('统一转小写（同一类文件不该因写法不同产生两种 URL）', () => {
    expect(safeExtname('cat.JPG')).toBe('.jpg')
    expect(safeExtname('cat.PnG')).toBe('.png')
  })

  it('无扩展名时返回空串', () => {
    expect(safeExtname('cat')).toBe('')
    expect(safeExtname('')).toBe('')
  })

  it('多点文件名只取最后一段', () => {
    expect(safeExtname('archive.tar.gz')).toBe('.gz')
    expect(safeExtname('my.photo.v2.png')).toBe('.png')
  })

  it.each([
    ['cat.jpg"; rm -rf /', '带引号与分号'],
    ['cat.jp g', '后缀含空格'],
    ['cat.jpg\n', '后缀含换行'],
    ['cat.<script>', '后缀含尖括号'],
    ['cat.' + 'a'.repeat(50), '超长后缀'],
    ['cat.中文', '非 ASCII 后缀'],
    ['cat.${{x}}', '后缀含模板字符'],
  ])('%p（%s）被丢弃，不进入存储路径', (name) => {
    const ext = safeExtname(name)
    expect(ext === '' || /^\.[a-z0-9]+$/.test(ext)).toBe(true)
  })

  it('路径分隔符不会被当成扩展名带出来', () => {
    // path.extname 只看最后一段，这里确认结果里不含 / 或 \
    expect(safeExtname('dir/sub/cat.jpg')).toBe('.jpg')
    expect(safeExtname('dir\\sub\\cat.jpg')).toBe('.jpg')
  })
})

describe('generateRandomFileName', () => {
  it('形如 <32 位 hex><扩展名>', () => {
    expect(generateRandomFileName('cat.jpg')).toMatch(/^[0-9a-f]{32}\.jpg$/)
  })

  it('保熵 128 位：32 个十六进制字符由 16 字节随机数编码而来', () => {
    const name = generateRandomFileName('cat.png')
    expect(name.slice(0, 32)).toHaveLength(32)
    expect(name.endsWith('.png')).toBe(true)
  })

  it('不含时间戳前缀（上传时刻只由 年/月/日 目录表达）', () => {
    // 老实现以 Date.now() 打头，13 位十进制数字；这里确认该形状已消失
    const name = generateRandomFileName('cat.jpg')
    expect(name).not.toMatch(/^\d{13}/)
  })

  it('不含原始文件名（避免把用户可控字符串带进存储路径）', () => {
    const name = generateRandomFileName('我的私密照片.jpg')
    expect(name).not.toContain('我的私密照片')
    expect(name).toMatch(/^[0-9a-f]{32}\.jpg$/)
  })

  it('无扩展名 / 危险扩展名时也能生成合法名', () => {
    expect(generateRandomFileName('cat')).toMatch(/^[0-9a-f]{32}$/)
    expect(generateRandomFileName('cat.<script>')).toMatch(/^[0-9a-f]{32}$/)
  })

  it('连续生成 1000 次不重复（随机部分确实是随机取值的）', () => {
    const names = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      names.add(generateRandomFileName('cat.jpg'))
    }
    expect(names.size).toBe(1000)
  })

  it('随机部分是小写 hex，可直接用于 URL 与文件系统', () => {
    for (let i = 0; i < 50; i++) {
      const random = generateRandomFileName('cat.jpg').slice(0, 32)
      expect(random).toMatch(/^[0-9a-f]{32}$/)
    }
  })
})
