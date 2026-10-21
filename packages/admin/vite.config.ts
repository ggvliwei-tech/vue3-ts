import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

/**
 * 读取 .env / .env.local（mode 固定 development：代理只在 dev server 生效）
 *
 * 用 loadEnv 而不是只读 process.env：Windows 下在 npm script 里写
 * `VITE_API_TARGET=... vite` 这种前缀赋值根本不会生效，开发者只能改代码。
 * 放进 .env.local（已被 .gitignore 忽略）才能既跨平台又不污染仓库。
 */
const env = loadEnv('development', __dirname, '')

/**
 * 解析 API 代理目标。
 *
 * 默认 **127.0.0.1:3000**，而不是自动探测本机 LAN IP：
 *  - compose 里的 backend 只发布在 127.0.0.1:3000（见 docker-compose.yml 的 ports），
 *    用 LAN IP 去连会直接 ECONNREFUSED，Vite 代理返回 500，页面上所有接口都像挂了；
 *  - 自动探测还可能选中 VPN / WSL 虚拟网卡，换台机器结果就变。
 *
 * 代理运行在宿主机上，所以手机用 http://<局域网IP>:5175 访问时，target 仍写回环即可。
 *
 * 本地调试「后端也跑在宿主机」时，在 packages/admin/.env.local 写：
 *   VITE_API_TARGET=http://127.0.0.1:3001
 * （后端同步在 packages/server/.env.local 设 APP_PORT=3001，避开 Docker 的 3000）
 *
 * 优先级：shell 环境变量 > .env.local > .env > 默认值。
 */
function resolveApiTarget(): string {
  const explicit =
    process.env.LAN_API_TARGET ||
    env.LAN_API_TARGET ||
    process.env.VITE_API_TARGET ||
    env.VITE_API_TARGET ||
    process.env.API_TARGET ||
    env.API_TARGET
  if (explicit) return explicit.replace(/\/+$/, '')
  return 'http://127.0.0.1:3000'
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
      // 本地存储的上传文件由后端以 /uploads/** 提供。
      // 不代理时浏览器会向 Vite（5175）要图片，拿到 404 或 index.html，
      // 表现为「上传成功但预览全裂」—— 生产环境有 nginx 转这条路径，dev 没有。
      '/uploads': {
        target: API_TARGET,
        changeOrigin: true,
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
