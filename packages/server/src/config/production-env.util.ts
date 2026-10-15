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
 * `docker-compose.yml` 默认打开该开关以保证"一键启动"可用 —— 对外部署前必须关掉。
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

  // ========== CORS 白名单：只告警 ==========
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
