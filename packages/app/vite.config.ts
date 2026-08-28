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
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('vue')) return 'vue'
            if (id.includes('vant')) return 'vant'
          }
        },
      },
    },
  },
})
