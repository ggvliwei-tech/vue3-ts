/**
 * 生产环境配置自检
 *
 * 背景：本仓库的 `.env.example` 与 `docker-compose.yml` 都带着**可直接运行**的占位密钥
 * （JWT 签名密钥、数据库/Redis 密码）。照抄这份配置上线，等于把 JWT 签名密钥公开 ——
 * 任何能看到仓库的人都能用它自签一个合法的管理员 access token，全程不需要知道
 * 任何账号密码。这类配置事故不会在启动日志里报错，只会在被利用时才被发现。
 *
 * 所以这里做一次启动期强校验：`NODE_ENV=production`（或 `staging`）且发现
 * 占位 / 过弱的密钥时**直接拒绝启动**，而不是打条日志继续跑。
 *
 * 之所以要"拒绝启动"而不是"警告"：警告会淹没在启动横幅里，而配置错误的后果
 * （密钥公开 → 任意伪造登录态）是静默的、且与"服务正常运行"的外观完全一致。
 * 一个起不来的进程，运维 5 秒内就会发现；一个能正常服务但密钥是公开的进程，
 * 可能几个月都没人察觉。
 *
 * 逃生舱：本机演示 / 私有部署确实需要带着占位密钥跑起来，可显式设置
 * `ALLOW_INSECURE_DEFAULTS=true` 跳过校验（此时会打一条醒目告警）。
 * `docker-compose.yml` 的默认值是 false —— 即默认 fail-closed。
 * 早先那里默认 true 是为了让「一键启动」能跑起来，代价是这道防线在文档
 * 主路径上等于不存在：照 README 部署的人不会记得回头把它关掉。
 */

/** 本项自检生效的环境；与 sms.service.ts 对 staging 的处理保持一致 */
const GUARDED_ENVS = ['production', 'staging']

/**
 * 公开在仓库里的默认值。
 * 这些值出现在受保护环境的配置里即为配置事故 —— 它们已经写在 .env.example 和
 * docker-compose.yml 里，等同于泄露。
 */
const PLACEHOLDER_VALUES = new Set([
  'please-change-me-access-secret-in-production-32chars-min',
  'please-change-me-refresh-secret-in-production-32chars-min',
  'vue3_pass_2026',
  'redis_pass_2026',
  'root123456',
])

/**
 * JWT 密钥最短长度（字符数）。
 * HS256 的密钥强度取决于熵而非长度，32 字符是"用随机 hex 生成时约 128 位"的下限；
 * 比这更短的值几乎必然是手敲的弱口令。
 */
const MIN_SECRET_LENGTH = 32

export interface ProductionEnvIssue {
  /** 出问题的环境变量名 */
  key: string
  /** 人类可读的原因与后果 */
  reason: string
}

export interface ProductionEnvCheckResult {
  /** 必须修复，否则拒绝启动 */
  errors: ProductionEnvIssue[]
  /** 建议修复，不拦截启动 */
  warnings: ProductionEnvIssue[]
}

/**
 * 检查生产环境配置，返回问题清单。
 *
 * 纯函数：不读文件、不打印、不抛错，环境变量由参数传入 —— 便于单测直接构造用例。
 *
 * @param env 环境变量对象，默认取 process.env
 */
export function checkProductionEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProductionEnvCheckResult {
  const errors: ProductionEnvIssue[] = []
  const warnings: ProductionEnvIssue[] = []
  const result = { errors, warnings }

  // 非受保护环境（开发/测试）不校验：本地跑起来不该被密钥强度挡住
  if (!GUARDED_ENVS.includes(env.NODE_ENV ?? '')) return result
  // 显式跳过（见文件头"逃生舱"）
  if (env.ALLOW_INSECURE_DEFAULTS === 'true') return result

  // ========== JWT 签名密钥 ==========
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const value = env[key]
    if (!value) {
      errors.push({ key, reason: '未配置。缺少签名密钥时服务无法签发/校验令牌' })
    } else if (PLACEHOLDER_VALUES.has(value)) {
      errors.push({
        key,
        reason:
          '仍是 .env.example / docker-compose.yml 里的占位值。该值已随仓库公开，' +
          '等同于签名密钥泄露 —— 任何人都能伪造管理员令牌',
      })
    } else if (value.length < MIN_SECRET_LENGTH) {
      errors.push({
        key,
        reason: `长度仅 ${value.length}，不足 ${MIN_SECRET_LENGTH} 位，强度不足以支撑令牌的有效期`,
      })
    }
  }
  // 两个密钥相同：access / refresh 的签名与校验就走同一把钥匙，
  // 一个短期 access token 可以被当作长期 refresh token 提交，变相绕过过期时间
  if (
    env.JWT_ACCESS_SECRET &&
    env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET
  ) {
    errors.push({
      key: 'JWT_REFRESH_SECRET',
      reason:
        '与 JWT_ACCESS_SECRET 相同。两者复用同一密钥后，access token 可被当作 refresh token 提交，绕过短有效期',
    })
  }

  // ========== 数据库密码 ==========
  if (env.DB_PWD && PLACEHOLDER_VALUES.has(env.DB_PWD)) {
    errors.push({
      key: 'DB_PWD',
      reason: '仍是公开在仓库里的默认密码，数据库等同于对外开放',
    })
  }

  // ========== Redis 密码 ==========
  // 单独判空：Redis 里存着全部会话与 refresh token（见 common/constants/auth-keys.ts），
  // 未设密码时，任何能连上 6379 的人都能直接读写登录态
  if (!env.REDIS_PASSWORD) {
    errors.push({
      key: 'REDIS_PASSWORD',
      reason:
        '为空。Redis 存放全部会话与 refresh token，无密码时任何能访问 6379 端口的人' +
        '都可以直接伪造登录态；若确实只在隔离内网且端口不对外发布，可用 ' +
        'ALLOW_INSECURE_DEFAULTS=true 显式跳过',
    })
  } else if (PLACEHOLDER_VALUES.has(env.REDIS_PASSWORD)) {
    errors.push({
      key: 'REDIS_PASSWORD',
      reason: '仍是公开在仓库里的默认密码',
    })
  }

  // ========== CORS 白名单：全部只告警，不拦截启动 ==========
  // 本地回环来源在正式部署里几乎没有意义，但它同时也是"一键启动 demo"的
  // 合法配置（docker-compose 默认就是 localhost:8080/8081），所以不能拦。
  const origins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (origins.some((o) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o))) {
    warnings.push({
      key: 'CORS_ORIGINS',
      reason:
        '白名单里含 localhost / 127.0.0.1。正式对外部署请替换为真实域名，' +
        '否则浏览器侧仍按本地地址放行',
    })
  }
  // `*` 这条**不是**"放开所有来源"，而是彻底反过来 —— 务必不要按直觉理解：
  // isOriginAllowed（common/utils/cors.util.ts）做的是 `allowed.includes(origin)`，
  // 拿字面量 '*' 去和真实 origin 比对，永远不相等；而生产环境下局域网兜底正则
  // （LAN_ORIGIN_REGEX）是关闭的。于是写了 `*` 的效果等于白名单是空的：
  // 同源请求照常（本就不受 CORS 约束），所有跨域请求全被拒。
  // 典型症状是"登录成功但紧接着刷新 token 失败"，与 CORS 毫无关联感，
  // 排查成本很高 —— 所以给一条明确的提醒，而不是等运维去猜。
  //
  // 不升级为 error：写 `*` 并没有打开任何口子（没放宽），且同源部署下一切正常，
  // 拦掉启动反而会把一个能正常服务的进程弄挂。也不要反过来去"实现"通配符支持 ——
  // 那才是真的放宽。
  if (origins.includes('*')) {
    warnings.push({
      key: 'CORS_ORIGINS',
      reason:
        "含 `*`，但它**不会**放行任何来源：判定逻辑是精确字符串比对，'*' 匹配不上任何 " +
        '真实 origin，且生产环境已关闭局域网兜底，实际效果等同于白名单为空 —— ' +
        '同源请求正常、全部跨域请求被拒（典型症状：登录成功但刷新 token 失败）。' +
        '请逐项填写真实的前端地址（含协议与端口）',
    })
  }
  // 空值同样只告警：admin / app 由同一个 nginx 反代时，前端与 /api 是同源的，
  // 跨域根本不会发生，这时留空是**正确**配置（见 README「生产 HTTPS 部署」）。
  // 把空值判成 error 会恰好挡住最推荐的部署形态。

  // ========== LLM：只告警 ==========
  // 缺 key 只让 AI 对话 / 知识库不可用，不影响登录与其余业务，
  // 因此不该阻断启动（.env.example 里已注明"启动期不校验"，这里补上提醒即可）。
  const llmType = env.LLM_TYPE || 'openai' // 与 LlmTypeEnum.OPENAI 一致（modules/ai/enums/llm-type.enum.ts）
  // 每种 provider 需要的 key；local_ollama 跑本地模型，不需要 key
  const requiredKey: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    dashscope_qwen: 'DASHSCOPE_API_KEY',
  }
  const keyName = requiredKey[llmType]
  if (keyName && !env[keyName]) {
    warnings.push({
      key: keyName,
      reason:
        `LLM_TYPE=${llmType} 但 ${keyName} 为空。服务会正常启动，` +
        '直到第一次对话才在调用处报鉴权错误，容易被误判成后端 bug',
    })
  } else if (!keyName && llmType !== 'local_ollama') {
    // 写错 provider 名时 provider 会静默落到 Ollama 分支（见 llm-provider.service.ts 的
    // 默认分支），而 Ollama 分支的 embeddings 是 null —— 知识库整体不可用。
    warnings.push({
      key: 'LLM_TYPE',
      reason:
        `取值「${llmType}」不是已知 provider（openai / dashscope_qwen / local_ollama），` +
        '会静默回落到本地 Ollama 分支，导致知识库（embedding）不可用',
    })
  }

  return result
}

/**
 * 把校验结果格式化成可直接打印的多行文本。
 * 单独抽出来是为了让 main.ts 保持简洁，同时让提示文案能被单测覆盖。
 */
export function formatProductionEnvIssues(
  result: ProductionEnvCheckResult,
): string {
  const lines: string[] = []
  if (result.errors.length > 0) {
    lines.push('')
    lines.push('启动被拒绝：生产环境配置存在高危项。')
    lines.push('')
    for (const issue of result.errors) {
      lines.push(`  ✗ ${issue.key}`)
      lines.push(`      ${issue.reason}`)
    }
    lines.push('')
    lines.push('  修复方式：在 packages/server/.env 中填入真实密钥。')
    lines.push('  生成 JWT 密钥：node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"')
    lines.push('  （本机演示确需沿用占位值：设置 ALLOW_INSECURE_DEFAULTS=true 跳过本检查）')
    lines.push('')
  }
  if (result.warnings.length > 0) {
    lines.push('')
    lines.push('配置提醒（不阻止启动）：')
    lines.push('')
    for (const issue of result.warnings) {
      lines.push(`  ! ${issue.key}`)
      lines.push(`      ${issue.reason}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
