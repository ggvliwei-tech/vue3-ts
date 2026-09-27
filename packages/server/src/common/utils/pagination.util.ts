/**
 * 分页查询参数的运行时解析
 *
 * 为什么需要这个文件：
 * `@Query('page') page = 1` 这种写法会让 TypeScript 把 page 推断成 `number`
 * （默认值是数字字面量），但 Express 查询串里取出来的**永远是 string 或 undefined**。
 * 类型系统在这里是失效的，`+page` 遇到 `?page=abc` 会得到 NaN。
 *
 * 而 NaN 一旦进入 TypeORM 会直接抛异常：
 *   findAndCount({ skip: NaN })
 *   → SelectQueryBuilder 用 `skip !== undefined` 判断（注意不是 truthy 判断，NaN 能过）
 *   → QueryBuilder.validateNumericInput 发现 isNaN → 抛 TypeORMError
 *   → 这不是 HttpException，被 GlobalExceptionFilter 兜底成 500 / code 20000
 * 即一个手写的错误 query 参数能把接口打成 500。
 *
 * 这里统一兜底：非法、非正、非有限的值一律退回默认值，接口不再因入参报 5xx。
 */

/** 分页参数上限：防止 `?limit=100000000` 把库拖垮 */
export const MAX_PAGE_SIZE = 100

/**
 * 把查询串里的值解析成正整数
 *
 * 接受 string（查询串原始类型）或 number，其余类型视为非法。
 * 非法输入（'abc'、''、'-1'、'0'、'1.5'、'NaN'、null、undefined）返回 fallback。
 *
 * @param raw 查询串原始值，通常是 string | undefined
 * @param fallback 非法时的兜底值（会被 clamp 到 [1, max]）
 * @param max 上限，默认 MAX_PAGE_SIZE
 */
export function parsePositiveInt(
  raw: unknown,
  fallback: number,
  max: number = MAX_PAGE_SIZE,
): number {
  // 先把 max / fallback 净化，再解析 raw
  //
  // 不能省这一步：Math.max(NaN, 1) 的结果是 NaN（Math 系列函数对 NaN 是"污染"语义，
  // 不是"忽略"），所以若直接写 Math.min(Math.max(Math.trunc(fallback), 1), max)，
  // 一旦调用方传进来的 fallback 或 max 是 NaN，返回值就是 NaN —— 正好把这个工具
  // 唯一要防的东西（NaN 进 TypeORM 抛错 → 500）又放了出去。fallback 是字面量时
  // 看不出问题，所以这里必须显式兜住。
  const safeMax = Number.isInteger(max) && max >= 1 ? max : MAX_PAGE_SIZE
  const safeFallback =
    Number.isInteger(fallback) && fallback >= 1
      ? Math.min(fallback, safeMax)
      : 1

  const num = typeof raw === 'number' ? raw : Number(String(raw).trim())

  // Number('') === 0，所以空串也会在这里被拦下
  if (!Number.isInteger(num) || num < 1) {
    return safeFallback
  }

  return Math.min(num, safeMax)
}
