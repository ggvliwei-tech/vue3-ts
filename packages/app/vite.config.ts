import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      external: ['@project/shared'],
      output: {
        // 代码分割：将 Vue 相关库单独打包
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('vue')) {
              return 'vue'
            }
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: ['@project/shared'],
  },
})
