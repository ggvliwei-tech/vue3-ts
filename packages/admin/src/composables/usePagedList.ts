/**
 * usePagedList - 通用分页列表 composable
 *
 * 统一管理：list / total / loading / searchKeyword / currentPage / pageSize
 *
 * ⚠️ 迁移只做了一半：目前**只有 UserManage.vue 在用**。
 * RoleManage / PermissionManage / AuditLog 三个页面各自还留着一份逐字重复的
 * 分页实现（list/total/loading/page/pageSize/keyword + loadList/handleSearch/
 * handlePageChange/handleSizeChange，每份约 40 行）。新增管理页请直接用本 composable，
 * 不要再抄第四份；那三个页面也欢迎迁过来。
 *
 * 业务侧只需提供 fetcher（接收 { page, pageSize, keyword } 返回 PageRes<T>），
 * composable 内部封装：
 *  - 首次自动加载
 *  - searchKeyword 变更时重置到第一页
 *  - 切换页码时自动加载
 *  - reload() 提供给操作后手动刷新
 *
 * 类型 T 由调用方通过泛型指定，无需手动 cast。
 */
import { ref, watch, type Ref } from 'vue'

export interface PageQuery {
  page: number
  pageSize: number
  /** 搜索关键词（前端分页时不传给后端；后端分页时透传） */
  keyword?: string
}

export interface PageRes<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

export interface UsePagedListOptions<T> {
  /** 初始每页大小 */
  pageSize?: number
  /** 拉数据函数 */
  fetcher: (q: PageQuery) => Promise<PageRes<T>>
}

export interface UsePagedListReturn<T> {
  list: Ref<T[]>
  total: Ref<number>
  loading: Ref<boolean>
  searchKeyword: Ref<string>
  currentPage: Ref<number>
  pageSize: Ref<number>
  /** 重新加载当前页（操作成功后调用） */
  reload: () => Promise<void>
  /** 重置并刷新（搜索条件改变后调用） */
  reset: () => Promise<void>
}

export function usePagedList<T = unknown>(
  options: UsePagedListOptions<T>,
): UsePagedListReturn<T> {
  const list = ref<T[]>([]) as Ref<T[]>
  const total = ref(0)
  const loading = ref(false)
  const searchKeyword = ref('')
  const currentPage = ref(1)
  const pageSize = ref(options.pageSize ?? 10)

  async function load() {
    loading.value = true
    try {
      const res = await options.fetcher({
        page: currentPage.value,
        pageSize: pageSize.value,
        keyword: searchKeyword.value || undefined,
      })
      list.value = res.list as T[]
      total.value = res.total
    } finally {
      loading.value = false
    }
  }

  async function reload() {
    await load()
  }

  async function reset() {
    currentPage.value = 1
    await load()
  }

  // 监听搜索条件 / 页码变化自动加载
  watch(searchKeyword, () => {
    currentPage.value = 1
    load()
  })
  watch([currentPage, pageSize], () => load())

  // 首次加载
  load()

  return { list, total, loading, searchKeyword, currentPage, pageSize, reload, reset }
}
