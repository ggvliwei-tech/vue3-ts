/**
 * `import.meta.env` 的环境变量声明。
 *
 * 为什么这里手写一份而不是用 `vite/client`：
 * shared 不依赖 vite（它同时被服务端与 vitest 消费），引不进来那份类型；
 * 而没有声明时，`import.meta.env.xxx` 在 tsc 下是 `any`，
 * 只能靠 `(import.meta as any).env` 绕 —— 那等于把变量名的拼写错误
 * 也一并放过（写错名字得到的只是 undefined，不报错）。
 *
 * 只声明 shared 真正读的那几个变量。admin / app 侧已通过
 * tsconfig 的 `"types": ["vite/client"]` 拿到完整声明，
 * interface 合并不会冲突（两边都定义同名属性且类型一致才安全，
 * 这里刻意不重复声明 Vite 内置的 BASE_URL / MODE / DEV / PROD / SSR）。
 */
interface ImportMetaEnv {
  /** 后端 API 基础地址，未配置时回落到同源 */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
