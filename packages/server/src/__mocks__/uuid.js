/**
 * uuid mock for Jest
 *
 * 真实 uuid@14 是纯 ESM（dist-node/index.js 第一行就是 `export`），
 * Jest + ts-jest 走 CommonJS 解析会报 SyntaxError。
 *
 * 测试只需一个稳定的 UUID v4 格式字符串，递增计数器即可保证唯一性。
 */

let counter = 0

module.exports = {
  v4: () => {
    counter += 1
    const hex = counter.toString(16).padStart(12, '0')
    // 格式化为标准 UUID v4（最后一段首字母设为 4 模拟版本）
    return `00000000-0000-4000-8000-${hex.padStart(12, '0')}`
  },
}