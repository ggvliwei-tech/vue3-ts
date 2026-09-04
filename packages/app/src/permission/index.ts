/**
 * App 端权限模块
 *
 * 权限的唯一真源在 admin 后台（sys_role / sys_permission / sys_role_permission），
 * app 端只负责「消费」：登录时后端把当前用户的 permissions 一并下发，
 * 这里把权限码收敛成常量 + 提供功能入口配置 + 同步逻辑，
 * 供路由守卫、首页宫格、v-permission 指令共用。
 *
 * 注意：前端过滤只是体验层（不该看到的入口不展示），
 * 真正的安全边界在后端 PermissionsGuard 和 ChatGateway 的连接校验上。
 */
import { useAuthStore } from '@project/shared/stores/useAuthStore'
import { getUserProfile } from '@/api/user'

/**
 * 权限码常量：必须与 nest-db.sql 中 sys_permission.code 完全一致。
 * 集中在此处声明，避免权限码字符串散落在各个页面里拼错。
 */
export const PERM = {
  /** 查看账本列表 */
  BOOK_LIST: 'book:list',
  /** 创建账本 */
  BOOK_CREATE: 'book:create',
  /** 修改账本 */
  BOOK_UPDATE: 'book:update',
  /** 删除账本 */
  BOOK_DELETE: 'book:delete',
  /** 查看文件列表 */
  FILE_LIST: 'file:list',
  /** 上传文件 */
  FILE_UPLOAD: 'file:upload',
  /** 删除文件 */
  FILE_DELETE: 'file:delete',
  /** AI 对话 */
  AI_CHAT: 'ai:chat',
  /** 进入聊天室（房间列表 / 成员 / 历史消息 / WS 长连接） */
  CHAT_ROOM: 'chat:room',
  /** 创建聊天室 */
  CHAT_ROOM_CREATE: 'chat:room-create',
  /** 删除聊天室 */
  CHAT_ROOM_DELETE: 'chat:room-delete',
} as const

/** 首页宫格功能入口配置：每个入口声明需要的权限码，无权限则不渲染 */
export interface HomeEntry {
  /** 入口文案 */
  text: string
  /** Vant 图标名 */
  icon: string
  /** 点击后跳转的路由 */
  route: string
  /** 展示该入口所需的权限码（拥有任一即可） */
  permissions: string[]
}

export const HOME_ENTRIES: HomeEntry[] = [
  { text: '账本', icon: 'balance-o', route: '/account-book', permissions: [PERM.BOOK_LIST] },
  { text: '文件', icon: 'notes-o', route: '/file-list', permissions: [PERM.FILE_LIST] },
  { text: 'AI', icon: 'chat', route: '/ai-chat', permissions: [PERM.AI_CHAT] },
  { text: '聊天室', icon: 'comment-o', route: '/rooms', permissions: [PERM.CHAT_ROOM] },
]

/**
 * 从后端拉取最新的 roles / permissions 覆盖本地缓存。
 *
 * 为什么需要：权限是登录时随 token 下发并存进 sessionStorage 的，
 * 但 admin 后台随时可能改角色。后端在改角色时会 clearUserCache，
 * 所以这里拉一次 profile 就能拿到即时生效的权限，不必等用户重新登录。
 *
 * 失败时静默返回 false（不阻塞应用启动）：401 会由 request 层的
 * 刷新 / 登出回调统一处理，其他错误则沿用本地缓存的旧权限。
 */
export async function syncPermissions(): Promise<boolean> {
  const authStore = useAuthStore()
  if (!authStore.isLoggedIn) return false

  try {
    const res = await getUserProfile()
    const profile = res.data
    authStore.setUserInfo({
      id: profile.id,
      username: profile.username,
      status: profile.status,
      roles: profile.roles ?? [],
      permissions: profile.permissions ?? [],
    })
    return true
  } catch {
    return false
  }
}

/** 当前用户是否拥有指定权限码中的任意一个（空数组视为不限制） */
export function hasAnyPermission(permissions: string[]): boolean {
  if (permissions.length === 0) return true
  return useAuthStore().hasAnyPermission(permissions)
}

/** 按权限过滤首页功能入口 */
export function filterHomeEntries(): HomeEntry[] {
  return HOME_ENTRIES.filter((entry) => hasAnyPermission(entry.permissions))
}
