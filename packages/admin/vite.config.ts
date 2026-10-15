import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { networkInterfaces } from 'os'

/**
 * 探测本机首个非回环 IPv4
 */
function getPrimaryIPv4(): string {
  const interfaces = networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      const familyV4 = typeof net.family === 'string' ? 'IPv4' : 4
      if (net.family === familyV4 && !net.internal) {
        return net.address
      }
    }
  }
  return 'localhost'
}

/**
 * 解析 API 代理目标
 * admin 端优先用 LAN_API_TARGET（与 app 区分命名空间）
 */
function resolveApiTarget(): string {
  const explicit =
    process.env.LAN_API_TARGET ||
    process.env.VITE_API_TARGET ||
    process.env.API_TARGET
  if (explicit) return explicit.replace(/\/+$/, '')
  return `http://${getPrimaryIPv4()}:3000`
}

const API_TARGET = resolveApiTarget()

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia', { 'lodash-es': ['debounce', 'throttle', 'cloneDeep', 'isEmpty', 'merge', 'pick', 'omit', 'groupBy', 'sortBy'] }],
      resolvers: [ElementPlusResolver()],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    host: true,
    port: 5175,
    strictPort: false,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path,
      },
    },
  },
  // ⚠️ 这里**不要**再写 optimizeDeps.include: ['@project/shared']。
  //
  // @project/shared 的 package.json 把 main/exports 都指向 src/*.ts（未编译的
  // 工作区源码），把它列进 include 等于让 Vite 用 esbuild 预打包一份副本缓存到
  // node_modules/.vite/deps/@project_shared.js。问题在于那份缓存的失效依据是
  // lockfile 与配置的哈希，**不包含 linked 包的源码内容** —— 共享包改了源码
  // （加一个导出、加一个函数），dev server 依旧吐旧副本，浏览器直接报
  //   Uncaught SyntaxError: The requested module '.../@project_shared.js'
  //   does not provide an export named 'settleWithin'
  // 而同一份代码 build 出来是好的（构建走 Rollup，读的是源码），于是表现为
  // 「本地跑不起来、打包没问题」，且必须 `--force` 或删缓存才能恢复 —— 每个
  // 改过共享包的人都会踩一次。
  //
  // 不 include 时 Vite 把它当 linked 依赖按源码处理：改动即时生效、HMR 正常，
  // 与 app 端 vite.config.ts 保持一致（那边从来没有这一段）。若将来确实需要
  // 预打包（例如共享包换成编译产物 dist），改成 exclude 并同步删除本注释。
})
