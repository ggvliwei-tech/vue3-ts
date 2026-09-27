/**
 * 认证状态持久化层 —— token / userInfo 的唯一读写入入口
 *
 * 为什么需要这个文件：
 * 修复前 token 同时存在两个位置且互不一致 —— AuthStore 写
 * sessionStorage['auth.token']，而 request 拦截器 / 路由守卫 / websocket /
 * SSE / 多个页面组件全部读 localStorage['token']。
 * 登录时两边各写一次，看起来一致；但**新标签页的 sessionStorage 是空的**，
 * 于是必然踩中这条死锁：
 *   守卫读 localStorage → 判定已登录 → 放行
 *   组件读 store(sessionStorage) → 空 → permissions = []
 *   → 路由守卫 hasAnyPermission 失败 → 跳 /403
 *   而唯一能补上权限的 syncPermissions() 内部又因 isLoggedIn=false 提前 return
 *   → 新标签页永远拿不到权限。
 *
 * 为什么统一到 localStorage 而不是 sessionStorage：
 * refresh token 存在 HttpOnly Cookie 里，**本来就是跨标签页共享**的。
 * 把 access token 隔离进 sessionStorage，等于"共用一个 RT、各持不同的 AT"，
 * 各标签页的静默续期定时器会在同一个 RT 上撞车，
 * 触发服务端的 RT 复用检测（判为令牌盗用 → 拉黑设备 → 强制下线）。
 * 让 AT 与 RT 的可见范围保持一致，才是自洽的。
 *
 * 约定：任何地方读写 token / userInfo 都必须经过本模块，
 * 不要再直接操作 localStorage，否则就会重现"写 A 读 B"那一类 bug。
 */

/** 与 AuthStore 的 UserInfo 结构一致 */
export interface StoredUserInfo {
  id: number
  username: string
  status?: number
  roles?: string[]
  permissions?: string[]
}

/** JWT payload 结构（仅解析，不验签） */
export interface JwtPayload {
  /** 用户 ID（subject） */
  sub?: number
  /** 用户名 */
  username?: string
  /** 签发时间（秒） */
  iat?: number
  /** 过期时间（秒） */
  exp?: number
}

/**
 * localStorage 中 token 的键名
 * 导出给 token-refresh 用：跨标签页的 storage 事件需要按 key 过滤
 */
export const TOKEN_STORAGE_KEY = 'auth.token'
/** localStorage 中 userInfo 的键名 */
export const USER_STORAGE_KEY = 'auth.userInfo'

/** M1 重构前使用的旧键，只在一次性迁移时读取 */
const LEGACY_TOKEN_KEY = 'token'
const LEGACY_KEYS = ['token', 'username', 'roles', 'permissions'] as const

/**
 * 安全获取 localStorage：
 * 隐私模式 / 禁用 Cookie / 非浏览器环境（SSR、单测）下访问会直接抛错
 */
function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

// ====================== 基础读写 ======================

/** 读取 access token，未登录返回空字符串 */
export function getToken(): string {
  try {
    return storage()?.getItem(TOKEN_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** 写入 access token（传空字符串等同于清除） */
export function setToken(token: string): void {
  try {
    const ls = storage()
    if (!ls) return
    if (token) {
      ls.setItem(TOKEN_STORAGE_KEY, token)
    } else {
      ls.removeItem(TOKEN_STORAGE_KEY)
    }
  } catch {
    // 配额满 / 隐私模式：静默失败，内存态仍可用
  }
}

/** 读取用户信息（roles / permissions） */
export function getUserInfo(): StoredUserInfo | null {
  try {
    const raw = storage()?.getItem(USER_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as StoredUserInfo) : null
  } catch {
    return null
  }
}

/** 写入用户信息（传 null 等同于清除） */
export function setUserInfo(info: StoredUserInfo | null): void {
  try {
    const ls = storage()
    if (!ls) return
    if (info) {
      ls.setItem(USER_STORAGE_KEY, JSON.stringify(info))
    } else {
      ls.removeItem(USER_STORAGE_KEY)
    }
  } catch {
    // 静默失败
  }
}

/** 清空全部认证状态（登出 / 会话失效） */
export function clearAuth(): void {
  setToken('')
  setUserInfo(null)
}

// ====================== JWT 解析（不验签，仅解码 payload） ======================

/**
 * 解析 JWT payload
 * @param token JWT 字符串，支持 "Bearer xxx" 或纯 xxx
 * @returns 解析结果，格式非法时返回 null
 */
export function parseJwt(token: string | null | undefined): JwtPayload | null {
  if (!token) return null
  const raw = token.startsWith('Bearer ') ? token.slice(7) : token
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  try {
    // base64url → base64：- 换 +，_ 换 /，再补齐 =
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return JSON.parse(atob(padded)) as JwtPayload
  } catch {
    return null
  }
}

/** 当前 token 的过期时间（毫秒时间戳），无 token 或解析失败返回 0 */
export function getTokenExp(): number {
  const payload = parseJwt(getToken())
  return payload?.exp ? payload.exp * 1000 : 0
}

/** 当前 token 所属用户 ID，解析失败返回 0 */
export function getUserIdFromToken(): number {
  return parseJwt(getToken())?.sub ?? 0
}

// ====================== 旧数据一次性迁移 ======================

/** 从旧键安全读取字符串数组 */
function readLegacyArray(ls: Storage, key: string): string[] {
  try {
    const raw = ls.getItem(key)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(String) : []
  } catch {
    return []
  }
}

/**
 * 把 M1 重构前写入的旧键（token / username / roles / permissions）
 * 迁移到新的统一键上，然后删除旧键。
 *
 * 只在新键不存在时迁移，避免覆盖用户已刷新过的较新状态。
 * 应在应用启动、任何鉴权判断之前调用一次。
 */
export function migrateLegacyStorage(): void {
  const ls = storage()
  if (!ls) return
  try {
    if (!ls.getItem(TOKEN_STORAGE_KEY)) {
      const legacyToken = ls.getItem(LEGACY_TOKEN_KEY)
      if (legacyToken) {
        ls.setItem(TOKEN_STORAGE_KEY, legacyToken)
        const sub = parseJwt(legacyToken)?.sub
        const info: StoredUserInfo = {
          // 旧数据没有单独存 id，从 token 的 sub 还原；
          // 万一老 token 没有 sub 则留 0，后续 syncPermissions 会用服务端数据覆盖
          id: typeof sub === 'number' ? sub : 0,
          username: ls.getItem('username') ?? '',
          roles: readLegacyArray(ls, 'roles'),
          permissions: readLegacyArray(ls, 'permissions'),
        }
        ls.setItem(USER_STORAGE_KEY, JSON.stringify(info))
      }
    }
  } catch {
    // 迁移失败不阻塞启动，用户重新登录即可
  }

  // 无论是否发生迁移，旧键都不再被任何代码读取，一律清掉避免长期残留
  for (const key of LEGACY_KEYS) {
    try {
      ls.removeItem(key)
    } catch {
      // 忽略
    }
  }
}
