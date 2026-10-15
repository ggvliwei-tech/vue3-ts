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
  /** 加载失败时的回调，用于弹提示 / 上报 */
  onError?: (err: unknown) => void
  /** 失败时是否清空列表，默认 false（保留上一次的数据） */
  clearOnError?: boolean
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
    } catch (err) {
      // 异常必须在这里吃掉。load() 有三个触发点，其中两个 —— 下面两个 watch
      // 回调、以及模块初始化时的首次加载 —— 都没有 await 也没有 catch，
      // 抛出去就是 unhandled rejection。前端表现则是**静默的空表**：
      // 接口 500 时 loading 归位、list 仍为空，用户看到"暂无数据"，
      // 完全分不清"真的没数据"和"请求挂了"。
      //
      // 默认保留上一次的列表，不清空：一次网络抖动不该把已经看到的数据抹掉。
      // 确实需要清空的场景（比如切换了筛选条件，旧数据已无意义）传 clearOnError。
      if (options.clearOnError) {
        list.value = [] as T[]
        total.value = 0
      }
      if (options.onError) {
        options.onError(err)
      } else {
        console.error('[usePagedList] 加载列表失败', err)
      }
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
