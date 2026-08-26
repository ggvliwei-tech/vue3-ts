<script setup lang="ts">
/**
 * 审计日志页面
 * 仅 admin 角色可见（路由 meta.permissions = ['user:audit']）
 */

import { onMounted, reactive, ref } from 'vue'
import { get } from '@project/shared/request'

// ========== 类型定义 ==========

// 审计日志记录
interface AuditLogItem {
  id: string
  userId: number | null
  username: string | null
  action: string
  resource: string | null
  resourceId: string | null
  ip: string | null
  userAgent: string | null
  status: 0 | 1
  detail: Record<string, any> | null
  createTime: number
}

// 分页响应
interface PageRes<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

// ========== 状态 ==========

// 日志列表
const list = ref<AuditLogItem[]>([])
// 总条数
const total = ref(0)
// 加载中
const loading = ref(false)
// 当前页
const page = ref(1)
// 每页条数
const pageSize = ref(20)

// 过滤条件
const filter = reactive({
  action: '',
  username: '',
  status: '' as '' | '0' | '1',
  startTime: '' as string,
  endTime: '' as string,
})

// 动作下拉选项
const actionOptions = [
  { label: '全部', value: '' },
  { label: '登录', value: 'login' },
  { label: '退出', value: 'logout' },
  { label: '退出全部', value: 'logout-all' },
  { label: '刷新Token', value: 'refresh' },
  { label: '踢下线', value: 'kick' },
  { label: '切换状态', value: 'toggle-status' },
  { label: '重置密码', value: 'reset-password' },
]

// ========== 方法 ==========

// 加载日志列表
async function loadList() {
  loading.value = true
  try {
    const res = await get<PageRes<AuditLogItem>>('/audit/logs', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        action: filter.action || undefined,
        username: filter.username || undefined,
        status: filter.status !== '' ? filter.status : undefined,
        startTime: filter.startTime ? new Date(filter.startTime).getTime() : undefined,
        endTime: filter.endTime ? new Date(filter.endTime).getTime() + 86399999 : undefined,
      },
    })
    list.value = res.data.list
    total.value = res.data.total
  } catch (e) {
    list.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

// 重置过滤条件
function resetFilter() {
  filter.action = ''
  filter.username = ''
  filter.status = ''
  filter.startTime = ''
  filter.endTime = ''
  page.value = 1
  loadList()
}

// 页码变化
function handlePageChange(p: number) {
  page.value = p
  loadList()
}

// 每页条数变化
function handleSizeChange(s: number) {
  pageSize.value = s
  page.value = 1
  loadList()
}

// 格式化时间戳
function formatTime(ts: number | null | undefined): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// 动作标签样式
function actionTagType(action: string): 'primary' | 'success' | 'warning' | 'info' | 'danger' {
  if (action === 'login') return 'primary'
  if (action === 'logout' || action === 'logout-all') return 'info'
  if (action === 'kick' || action === 'toggle-status') return 'warning'
  if (action === 'refresh') return 'success'
  if (action === 'reset-password') return 'danger'
  return 'info'
}

// 动作中文名
function actionLabel(action: string): string {
  return actionOptions.find((o) => o.value === action)?.label || action
}

// 初始化加载
onMounted(() => {
  loadList()
})
</script>

<template>
  <div class="audit-log">
    <!-- 过滤条件区 -->
    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" :model="filter" class="filter-form">
        <el-form-item label="动作">
          <el-select v-model="filter.action" placeholder="全部" clearable style="width: 140px">
            <el-option v-for="o in actionOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="用户名">
          <el-input v-model="filter.username" placeholder="模糊搜索" clearable style="width: 160px" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filter.status" placeholder="全部" clearable style="width: 100px">
            <el-option label="成功" value="1" />
            <el-option label="失败" value="0" />
          </el-select>
        </el-form-item>
        <el-form-item label="起始时间">
          <el-date-picker
            v-model="filter.startTime"
            type="datetime"
            placeholder="起始"
            value-format="YYYY-MM-DD HH:mm:ss"
            style="width: 200px"
          />
        </el-form-item>
        <el-form-item label="结束时间">
          <el-date-picker
            v-model="filter.endTime"
            type="datetime"
            placeholder="结束"
            value-format="YYYY-MM-DD HH:mm:ss"
            style="width: 200px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadList">查询</el-button>
          <el-button @click="resetFilter">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 日志列表 -->
    <el-card class="list-card" shadow="never">
      <el-table :data="list" v-loading="loading" border stripe style="width: 100%">
        <el-table-column prop="createTime" label="时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column prop="action" label="动作" width="110">
          <template #default="{ row }">
            <el-tag :type="actionTagType(row.action)" size="small">
              {{ actionLabel(row.action) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="username" label="用户" width="120" />
        <el-table-column prop="ip" label="IP" width="140" />
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">
              {{ row.status === 1 ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="resource" label="对象" width="100" />
        <el-table-column prop="resourceId" label="对象ID" width="100" />
        <el-table-column label="详情" min-width="280">
          <template #default="{ row }">
            <span v-if="row.detail" class="detail-cell">
              {{ JSON.stringify(row.detail) }}
            </span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="userAgent" label="UA" min-width="180" show-overflow-tooltip />
      </el-table>

      <!-- 分页 -->
      <el-pagination
        class="pagination"
        :current-page="page"
        :page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        background
        @current-change="handlePageChange"
        @size-change="handleSizeChange"
      />
    </el-card>
  </div>
</template>

<style scoped>
.audit-log {
  padding: 16px;
}
.filter-card {
  margin-bottom: 16px;
}
.filter-form {
  margin-bottom: -18px;
}
.list-card :deep(.el-card__body) {
  padding: 12px;
}
.detail-cell {
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 12px;
  color: #666;
  word-break: break-all;
}
.pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
