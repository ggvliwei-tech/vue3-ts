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
  build: {
    rollupOptions: {
      external: ['@project/shared'],
    },
  },
  optimizeDeps: {
    include: ['@project/shared'],
  },
})
