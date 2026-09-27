import { parsePositiveInt, MAX_PAGE_SIZE } from './pagination.util'

/**
 * 这组用例的核心目的是钉住一个真实 bug（已由源码逐层核实）：
 * `?page=abc` → NaN → TypeORM 的 skip 校验（`!== undefined` 而非 truthy 判断）
 * → 抛 TypeORMError → GlobalExceptionFilter 兜底成 500。
 * 只要 parsePositiveInt 永远不返回 NaN / 非正整数，这条 500 路径就不可能被触发。
 */
describe('parsePositiveInt', () => {
  it('正常数字字符串原样解析', () => {
    expect(parsePositiveInt('1', 10)).toBe(1)
    expect(parsePositiveInt('7', 10)).toBe(7)
    expect(parsePositiveInt('100', 10, MAX_PAGE_SIZE)).toBe(100)
  })

  it('数字类型入参同样可用（便于在 service 层复用）', () => {
    expect(parsePositiveInt(3, 10)).toBe(3)
  })

  it('绝对值超上限时 clamp 到 max', () => {
    expect(parsePositiveInt('999999', 10, MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE)
    expect(parsePositiveInt('101', 1, 100)).toBe(100)
  })

  // 这一组是本文件的重点：全部不能返回 NaN
  it.each([
    ['abc', '非数字字符串'],
    ['', '空串（Number("") === 0）'],
    ['   ', '纯空白'],
    ['0', '零不是合法页码'],
    ['-1', '负数'],
    ['-0.5', '负小数'],
    ['1.5', '非整数'],
    ['NaN', '字面量 NaN'],
    ['Infinity', 'Infinity'],
    ['undefined', '字符串 undefined'],
    ['null', '字符串 null'],
  ])('非法输入 %p（%s）退回 fallback 且结果一定是正整数', (raw) => {
    const result = parsePositiveInt(raw, 10)
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBeGreaterThanOrEqual(1)
  })

  it('undefined / null 退回 fallback', () => {
    expect(parsePositiveInt(undefined, 10)).toBe(10)
    expect(parsePositiveInt(null, 10)).toBe(10)
  })

  it('对象 / 数组等异类入参不抛异常', () => {
    expect(parsePositiveInt({}, 10)).toBe(10)
    expect(parsePositiveInt([], 10)).toBe(10)
  })

  it('fallback 本身非法时也会被修正为正整数', () => {
    // 防御调用方传了坏默认值，避免把 NaN 又带回去
    expect(parsePositiveInt('abc', 0)).toBe(1)
    expect(parsePositiveInt('abc', -5)).toBe(1)
    expect(parsePositiveInt('abc', NaN)).toBe(1)
  })

  it('返回值永远不可能是 NaN —— 这是不触发 TypeORM 500 的充分条件', () => {
    const samples: unknown[] = ['abc', '', '0', '-1', '1.5', undefined, null, {}, [], NaN]
    for (const s of samples) {
      expect(Number.isNaN(parsePositiveInt(s, 1))).toBe(false)
    }
  })
})
