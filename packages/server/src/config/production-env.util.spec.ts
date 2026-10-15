import { checkProductionEnv, formatProductionEnvIssues } from './production-env.util'

/**
 * 这组用例钉住的是「用仓库里的占位密钥上线」这条事故路径。
 *
 * 起因：.env.example 与 docker-compose.yml 都带着可直接运行的 JWT 签名密钥，
 * 照抄部署等于公开签名密钥 —— 任何人都能自签管理员令牌，而服务本身看起来一切正常。
 * 所以校验必须是「拒绝启动」而非「打条日志」：起不来会被立刻发现，能跑但密钥公开则不会。
 *
 * 用参数注入 env 而不是改 process.env，避免用例之间互相污染。
 */
describe('checkProductionEnv', () => {
  /** 一份"各项都合规"的生产配置，用例在此基础上只改动关心的字段 */
  const validProdEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    DB_PWD: 'a-strong-db-password',
    REDIS_PASSWORD: 'a-strong-redis-password',
    CORS_ORIGINS: 'https://admin.example.com,https://app.example.com',
    // LLM 相关也属于「一份正常的生产配置该有的东西」：缺 key 只告警不拦截，
    // 但基准配置里必须给上，否则下面那些 `expect(warnings).toEqual([...])`
    // 的精确断言会平白多出一条 LLM 提醒。
    LLM_TYPE: 'openai',
    OPENAI_API_KEY: 'sk-valid-looking-key',
  }

  it('完全合规的生产配置不产生任何问题', () => {
    const { errors, warnings } = checkProductionEnv(validProdEnv)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  // ---------- 环境判定 ----------

  it.each(['development', 'test', '', undefined])(
    'NODE_ENV=%p 时完全跳过校验（本地不该被密钥强度挡住）',
    (nodeEnv) => {
      const { errors } = checkProductionEnv({ NODE_ENV: nodeEnv })
      expect(errors).toEqual([])
    },
  )

  it('staging 与 production 同样受校验', () => {
    const { errors } = checkProductionEnv({ NODE_ENV: 'staging' })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('ALLOW_INSECURE_DEFAULTS=true 时跳过校验（本机演示的逃生舱）', () => {
    const { errors, warnings } = checkProductionEnv({
      NODE_ENV: 'production',
      ALLOW_INSECURE_DEFAULTS: 'true',
    })
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('ALLOW_INSECURE_DEFAULTS 只认字符串 true，其他值不生效', () => {
    // 写错成 1 / TRUE / yes 时必须继续拦截，否则这个开关会变成"手滑就静默失效"
    for (const flag of ['1', 'TRUE', 'yes', 'false', '']) {
      const { errors } = checkProductionEnv({
        ...validProdEnv,
        ALLOW_INSECURE_DEFAULTS: flag,
        JWT_ACCESS_SECRET: 'please-change-me-access-secret-in-production-32chars-min',
      })
      expect(errors.length).toBeGreaterThan(0)
    }
  })

  // ---------- JWT 密钥 ----------

  it('JWT 密钥是仓库里的占位值时拦截', () => {
    const { errors } = checkProductionEnv({
      ...validProdEnv,
      JWT_ACCESS_SECRET: 'please-change-me-access-secret-in-production-32chars-min',
      JWT_REFRESH_SECRET: 'please-change-me-refresh-secret-in-production-32chars-min',
    })
    expect(errors.map((e) => e.key)).toEqual([
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
    ])
    // 文案要点出后果，否则运维只会当成一条无关紧要的提示
    expect(errors[0].reason).toContain('伪造管理员令牌')
  })

  it('JWT 密钥缺失时拦截', () => {
    const { errors } = checkProductionEnv({
      ...validProdEnv,
      JWT_ACCESS_SECRET: undefined,
    })
    expect(errors.map((e) => e.key)).toContain('JWT_ACCESS_SECRET')
  })

  it('JWT 密钥短于 32 位时拦截', () => {
    const { errors } = checkProductionEnv({
      ...validProdEnv,
      JWT_ACCESS_SECRET: 'a'.repeat(31),
    })
    expect(errors.map((e) => e.key)).toContain('JWT_ACCESS_SECRET')
  })

  it('恰好 32 位是允许的（边界值不能被误伤）', () => {
    const { errors } = checkProductionEnv({
      ...validProdEnv,
      JWT_ACCESS_SECRET: 'a'.repeat(32),
    })
    expect(errors).toEqual([])
  })

  it('access 与 refresh 密钥相同时拦截', () => {
    const same = 'c'.repeat(48)
    const { errors } = checkProductionEnv({
      ...validProdEnv,
      JWT_ACCESS_SECRET: same,
      JWT_REFRESH_SECRET: same,
    })
    expect(errors.map((e) => e.key)).toEqual(['JWT_REFRESH_SECRET'])
    expect(errors[0].reason).toContain('refresh token')
  })

  // ---------- 存储密码 ----------

  it.each(['vue3_pass_2026', 'redis_pass_2026', 'root123456'])(
    'DB_PWD 为公开默认值 %p 时拦截',
    (pwd) => {
      const { errors } = checkProductionEnv({ ...validProdEnv, DB_PWD: pwd })
      expect(errors.map((e) => e.key)).toContain('DB_PWD')
    },
  )

  it('REDIS_PASSWORD 为空时拦截（会话与 refresh token 全在里面）', () => {
    const { errors } = checkProductionEnv({ ...validProdEnv, REDIS_PASSWORD: '' })
    expect(errors.map((e) => e.key)).toContain('REDIS_PASSWORD')
    expect(errors.find((e) => e.key === 'REDIS_PASSWORD')?.reason).toContain(
      'ALLOW_INSECURE_DEFAULTS',
    )
  })

  it('DB_PWD 为空时不报错（缺失由 configuration.ts 的 getEnv 负责）', () => {
    // 职责边界：本模块只判"值是否被公开过"，必填性由 getEnv 兜底，避免同一问题报两遍
    const { errors } = checkProductionEnv({ ...validProdEnv, DB_PWD: undefined })
    expect(errors.map((e) => e.key)).not.toContain('DB_PWD')
  })

  // ---------- CORS：告警而非拦截 ----------

  it('CORS 含 localhost 时只告警，不阻止启动', () => {
    // docker-compose 一键启动的默认值就是 localhost，拦下来等于毁掉一键启动
    const { errors, warnings } = checkProductionEnv({
      ...validProdEnv,
      CORS_ORIGINS: 'http://localhost:8080,http://localhost:8081',
    })
    expect(errors).toEqual([])
    expect(warnings.map((w) => w.key)).toEqual(['CORS_ORIGINS'])
  })

  it('CORS 里的 127.0.0.1 同样只告警', () => {
    const { warnings } = checkProductionEnv({
      ...validProdEnv,
      CORS_ORIGINS: 'http://127.0.0.1:8080',
    })
    expect(warnings.map((w) => w.key)).toEqual(['CORS_ORIGINS'])
  })

  it('域名里恰好含 localhost 字样（如 localhost.example.com）不算命中', () => {
    // 正则必须锚定到 host 整体，不能被子串误伤
    const { warnings } = checkProductionEnv({
      ...validProdEnv,
      CORS_ORIGINS: 'https://localhost.example.com',
    })
    expect(warnings).toEqual([])
  })

  it('CORS 写成 `*` 时告警，且明确说明它不放行任何来源', () => {
    // `*` 是精确字符串比对下的空集，不是通配符。这条用例同时钉住「不升级为 error」：
    // 写 `*` 没有放宽任何口子，拦掉启动只会把一个能正常同源服务的进程弄挂。
    const { errors, warnings } = checkProductionEnv({
      ...validProdEnv,
      CORS_ORIGINS: '*',
    })
    expect(errors).toEqual([])
    expect(warnings.map((w) => w.key)).toEqual(['CORS_ORIGINS'])
    expect(warnings[0].reason).toContain('不会')
  })

  it('CORS 留空不产生任何问题（同源部署下的正确配置）', () => {
    // admin / app 与 /api 由同一个 nginx 反代时请求本就同源，跨域不会发生。
    // 把空值判成 error 会恰好挡住最推荐的部署形态。
    const { errors, warnings } = checkProductionEnv({ ...validProdEnv, CORS_ORIGINS: '' })
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  // ---------- LLM：告警而非拦截 ----------

  it('LLM_TYPE 指定了 provider 却没给对应 key → 告警且不拦启动', () => {
    // 缺 key 只让 AI 对话不可用，登录与其余业务照常，不该阻断整个服务
    const { errors, warnings } = checkProductionEnv({
      ...validProdEnv,
      LLM_TYPE: 'dashscope_qwen',
      DASHSCOPE_API_KEY: '',
    })
    expect(errors).toEqual([])
    expect(warnings.map((w) => w.key)).toEqual(['DASHSCOPE_API_KEY'])
  })

  it('LLM_TYPE 为空时按 openai 判定（与 llm-provider 的默认分支一致）', () => {
    const { warnings } = checkProductionEnv({
      ...validProdEnv,
      LLM_TYPE: '',
      OPENAI_API_KEY: '',
    })
    expect(warnings.map((w) => w.key)).toEqual(['OPENAI_API_KEY'])
  })

  it('local_ollama 不需要任何 key', () => {
    const { warnings } = checkProductionEnv({
      ...validProdEnv,
      LLM_TYPE: 'local_ollama',
      OPENAI_API_KEY: '',
    })
    expect(warnings).toEqual([])
  })

  it('LLM_TYPE 写成未知值时告警（会静默回落到 Ollama，导致 embedding 不可用）', () => {
    const { warnings } = checkProductionEnv({ ...validProdEnv, LLM_TYPE: 'gpt4' })
    expect(warnings.map((w) => w.key)).toEqual(['LLM_TYPE'])
  })

  it('一次列出全部问题，而不是首项即返回', () => {
    // 逐个报错会让运维改一条重启一次；这里要求一次性给全
    const { errors } = checkProductionEnv({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'please-change-me-access-secret-in-production-32chars-min',
      JWT_REFRESH_SECRET: 'please-change-me-refresh-secret-in-production-32chars-min',
      DB_PWD: 'vue3_pass_2026',
      REDIS_PASSWORD: 'redis_pass_2026',
    })
    expect(errors.length).toBe(4)
  })
})

describe('formatProductionEnvIssues', () => {
  it('无问题时返回空串（不打印多余标题）', () => {
    expect(formatProductionEnvIssues({ errors: [], warnings: [] })).toBe('')
  })

  it('有 error 时带上环境变量名、原因与修复指引', () => {
    const text = formatProductionEnvIssues({
      errors: [{ key: 'JWT_ACCESS_SECRET', reason: '占位值' }],
      warnings: [],
    })
    expect(text).toContain('JWT_ACCESS_SECRET')
    expect(text).toContain('占位值')
    expect(text).toContain('.env')
  })

  it('只有 warning 时说明不会阻止启动', () => {
    const text = formatProductionEnvIssues({
      errors: [],
      warnings: [{ key: 'CORS_ORIGINS', reason: '含 localhost' }],
    })
    expect(text).toContain('不阻止启动')
    expect(text).toContain('CORS_ORIGINS')
  })
})
