import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { VantResolver } from '@vant/auto-import-resolver'
import { networkInterfaces } from 'os'

/**
 * 探测本机首个非回环 IPv4
 * 用于 Vite 代理默认目标 / 启动横幅
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
 * 优先级：
 *   1. VITE_API_TARGET 环境变量（运行时指定，跨平台）
 *   2. API_TARGET 环境变量（同上，向后兼容）
 *   3. 自动探测的本机 IPv4
 *   4. 回退 localhost
 */
function resolveApiTarget(): string {
  const explicit =
    process.env.VITE_API_TARGET || process.env.API_TARGET
  if (explicit) return explicit.replace(/\/+$/, '')
  return `http://${getPrimaryIPv4()}:3000`
}

const API_TARGET = resolveApiTarget()

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      imports: ['vue', { 'lodash-es': ['debounce', 'throttle', 'cloneDeep', 'isEmpty', 'merge', 'pick', 'omit', 'groupBy', 'sortBy'] }],
      resolvers: [VantResolver()],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [VantResolver()],
      dts: 'src/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    // 监听所有网卡
    host: true,
    port: 5173,
    strictPort: false,
    // Vite 5+：允许任意 Host 头（防 LAN 下 403）
    allowedHosts: true,
    proxy: {
      // REST API 代理
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // 安全设置：避免代理 304/302 时路径错乱
        rewrite: (path) => path,
      },
      // Socket.IO WebSocket 代理（聊天模块）
      '/socket.io': {
        target: API_TARGET,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * 手动分包
         *
         * 1）必须按**路径片段**匹配包名，不能用 id.includes('vue') 这种子串判断：
         *    rollup 传进来的 id 是绝对路径，而本仓库所在目录名就叫 vue3-monorepo，
         *    于是每个 node_modules 依赖的 id 里都含有 'vue' —— 所有依赖全落进 'vue'
         *    这一个 chunk，后面的分支永远不可达（等于没分包，首屏 preload 一个巨型 vendor）。
         *    同理匹配 node_modules 时也要带上分隔符，避免匹配到别处的同名片段。
         *
         * 2）Vue 核心 / vue-router / pinia / Vant 归为**同一组**：它们都在首屏链路上，
         *    且 Vant 硬依赖 Vue，拆开只会让两边互相 import。实测把它们分成两组时，
         *    rollup 仍会把 vue 核心并到 vant 那一组（剩下一个只有 vue-router + pinia 的
         *    30 kB 空壳 chunk），名字与实际内容对不上；显式合成一组后行为才可预期。
         *
         * 3）markdown-it 与 socket.io 只被懒加载页面用到（AI 对话、聊天室），
         *    单独成块，不拖累首屏。
         */
        manualChunks(id) {
          // 兼容 pnpm 的 .pnpm/<pkg>@<ver>/node_modules/<pkg>/... 布局
          const matched = id.match(
            /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/,
          )
          if (!matched) return

          // 匹配到的是**包名**（作用域包形如 @vue/shared），不是路径
          const pkg = matched[1]

          // 框架 + UI 库：首屏必需，始终一起加载
          if (
            pkg === 'vue' ||
            pkg === 'vue-router' ||
            pkg === 'pinia' ||
            pkg.startsWith('@vue/') ||
            pkg === 'vant' ||
            pkg.startsWith('@vant/')
          ) {
            return 'vue'
          }
          // 以下两个只有懒加载路由用到，独立成块
          if (pkg.startsWith('markdown-it')) return 'markdown-it'
          if (pkg.startsWith('socket.io') || pkg.startsWith('engine.io')) return 'socket'
        },
      },
    },
  },
})
