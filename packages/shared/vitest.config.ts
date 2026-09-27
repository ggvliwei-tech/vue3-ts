import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // auth-storage / token-refresh 依赖 localStorage、atob、window.storage 事件，
    // 必须在浏览器环境下运行
    environment: 'jsdom',
    // 测试放 test/ 而非 src/：package.json 的 build 是 `tsc`（rootDir=src），
    // 测试文件若在 src 下会被一起编译进 dist
    include: ['test/**/*.test.ts'],
  },
})
