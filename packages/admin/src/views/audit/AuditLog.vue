<script setup lang="ts">
/**
 * 审计日志管理页（增强版）
 * - 分页查询 / 多条件筛选 / 详情查看 / CSV 导出
 * - 权限码：admin:audit（使用管理端审计接口）
 */
import { onMounted, ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { get } from '@project/shared/request'

// ========== 类型定义 ==========
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

interface PageRes<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

// ========== 列表状态 ==========
const list = ref<AuditLogItem[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)

const filter = reactive({
  action: '',
  username: '',
  userId: '' as string | number,
  status: '' as '' | '0' | '1',
  startTime: '' as string,
  endTime: '' as string,
})

// ========== 详情抽屉 ==========
const detailVisible = ref(false)
const currentLog = ref<AuditLogItem | null>(null)

// ========== 动作枚举 ==========
const actionOptions: Array<{ label: string; value: string }> = [
  // 用户/认证
  { label: '登录', value: 'login' },
  { label: '登录失败', value: 'login' },
  { label: '退出', value: 'logout' },
  { label: '退出全部设备', value: 'logout-all' },
  { label: '刷新Token', value: 'refresh' },
  { label: '踢下线', value: 'kick' },
  { label: '切换状态', value: 'toggle-status' },
  { label: '重置密码', value: 'reset-password' },
  // 角色管理
  { label: '创建角色', value: 'role:create' },
  { label: '更新角色', value: 'role:update' },
  { label: '删除角色', value: 'role:delete' },
  { label: '分配角色权限', value: 'role:assign-permission' },
  // 权限管理
  { label: '创建权限', value: 'permission:create' },
  { label: '更新权限', value: 'permission:update' },
  { label: '删除权限', value: 'permission:delete' },
  // 用户角色
  { label: '分配用户角色', value: 'user-role:assign' },
  { label: '追加用户角色', value: 'user-role:add' },
  { label: '移除用户角色', value: 'user-role:remove' },
]

// 动作中文名映射表
const actionLabels: Record<string, string> = {
  login: '登录',
  logout: '退出',
  'logout-all': '退出全部',
  refresh: '刷新Token',
  kick: '踢下线',
  'toggle-status': '切换状态',
  'reset-password': '重置密码',
  'role:create': '创建角色',
  'role:update': '更新角色',
  'role:delete': '删除角色',
  'role:assign-permission': '分配角色权限',
  'permission:create': '创建权限',
  'permission:update': '更新权限',
  'permission:delete': '删除权限',
  'user-role:assign': '分配用户角色',
  'user-role:add': '追加用户角色',
  'user-role:remove': '移除用户角色',
}

function actionLabel(action: string): string {
  return actionLabels[action] || action
}

function actionTagType(action: string): 'primary' | 'success' | 'warning' | 'info' | 'danger' {
  if (action === 'login') return 'primary'
  if (action === 'logout' || action === 'logout-all' || action === 'logout') return 'info'
  if (action === 'kick' || action === 'toggle-status' || action.endsWith(':delete')) return 'danger'
  if (action === 'refresh') return 'success'
  if (action.endsWith(':create') || action.endsWith(':update')) return 'warning'
  if (action.endsWith(':assign') || action.endsWith(':add')) return 'warning'
  if (action.endsWith(':remove')) return 'danger'
  if (action === 'reset-password') return 'danger'
  return 'info'
}

// ========== 方法 ==========
async function loadList() {
  loading.value = true
  try {
    const res = await get<PageRes<AuditLogItem>>('/api/v1/admin/audit/logs', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        action: filter.action || undefined,
        username: filter.username || undefined,
        userId: filter.userId || undefined,
        status: filter.status !== '' ? filter.status : undefined,
        startTime: filter.startTime ? new Date(filter.startTime).getTime() : undefined,
        endTime: filter.endTime ? new Date(filter.endTime).getTime() + 86399999 : undefined,
      },
    })
    list.value = res.data.list
    total.value = res.data.total
  } catch (e: any) {
    ElMessage.error(e.message || '加载审计日志失败')
    list.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function resetFilter() {
  filter.action = ''
  filter.username = ''
  filter.userId = ''
  filter.status = ''
  filter.startTime = ''
  filter.endTime = ''
  page.value = 1
  loadList()
}

function handlePageChange(p: number) {
  page.value = p
  loadList()
}
function handleSizeChange(s: number) {
  pageSize.value = s
  page.value = 1
  loadList()
}

function formatTime(ts: number | null | undefined): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 查看详情 */
function handleViewDetail(row: AuditLogItem) {
  currentLog.value = row
  detailVisible.value = true
}

/** 复制详情 JSON 到剪贴板 */
async function copyDetail() {
  if (!currentLog.value?.detail) return
  try {
    await navigator.clipboard.writeText(JSON.stringify(currentLog.value.detail, null, 2))
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.error('复制失败')
  }
}

/** 导出当前查询结果为 CSV */
function handleExport() {
  if (list.value.length === 0) {
    ElMessage.warning('当前无数据可导出')
    return
  }
  // CSV 表头
  const headers = [
    'ID', '时间', '动作', '用户ID', '用户名', '状态',
    '对象类型', '对象ID', '客户端IP', 'UA', '详情',
  ]
  // 转义函数：包含逗号/引号/换行的字段需要用双引号包裹
  const escape = (v: any) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const rows = list.value.map((row) => [
    row.id,
    formatTime(row.createTime),
    actionLabel(row.action),
    row.userId ?? '',
    row.username ?? '',
    row.status === 1 ? '成功' : '失败',
    row.resource ?? '',
    row.resourceId ?? '',
    row.ip ?? '',
    row.userAgent ?? '',
    row.detail ?? '',
  ])
  const csv = [headers, ...rows].map((r) => r.map(escape).join(',')).join('\n')
  // 加 BOM 让 Excel 正确识别 UTF-8
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${list.value.length} 条记录`)
}

onMounted(loadList)
</script>

<template>
  <div class="audit-log">
    <!-- 过滤区 -->
    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" :model="filter" class="filter-form">
        <el-form-item label="动作">
          <el-select v-model="filter.action" placeholder="全部" clearable filterable style="width: 180px">
            <el-option v-for="o in actionOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="用户名">
          <el-input v-model="filter.username" placeholder="模糊搜索" clearable style="width: 140px" />
        </el-form-item>
        <el-form-item label="用户ID">
          <el-input v-model="filter.userId" placeholder="精确" clearable style="width: 110px" />
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
          <el-button type="success" @click="handleExport">导出CSV</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 列表 -->
    <el-card class="list-card" shadow="never">
      <el-table :data="list" v-loading="loading" border stripe style="width: 100%">
        <el-table-column prop="createTime" label="时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column prop="action" label="动作" width="160">
          <template #default="{ row }">
            <el-tag :type="actionTagType(row.action)" size="small">
              {{ actionLabel(row.action) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="username" label="用户" width="120">
          <template #default="{ row }">
            <span v-if="row.username">{{ row.username }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="ip" label="IP" width="140" />
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">
              {{ row.status === 1 ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="resource" label="对象" width="110" />
        <el-table-column prop="resourceId" label="对象ID" width="100" />
        <el-table-column label="详情" min-width="240">
          <template #default="{ row }">
            <span v-if="row.detail" class="detail-cell">{{ JSON.stringify(row.detail) }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleViewDetail(row)">
              详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>

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

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailVisible" title="审计日志详情" size="560px" direction="rtl">
      <div v-if="currentLog" class="detail-content">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="日志ID">{{ currentLog.id }}</el-descriptions-item>
          <el-descriptions-item label="时间">{{ formatTime(currentLog.createTime) }}</el-descriptions-item>
          <el-descriptions-item label="动作">
            <el-tag :type="actionTagType(currentLog.action)" size="small">
              {{ actionLabel(currentLog.action) }}
            </el-tag>
            <span class="action-code">（{{ currentLog.action }}）</span>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="currentLog.status === 1 ? 'success' : 'danger'" size="small">
              {{ currentLog.status === 1 ? '成功' : '失败' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="用户ID">{{ currentLog.userId ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="用户名">{{ currentLog.username ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="对象类型">{{ currentLog.resource ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="对象ID">{{ currentLog.resourceId ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="客户端IP">{{ currentLog.ip ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="User-Agent" v-if="currentLog.userAgent">
            <div class="ua-text">{{ currentLog.userAgent }}</div>
          </el-descriptions-item>
        </el-descriptions>

        <div class="detail-block">
          <div class="block-header">
            <span class="block-title">扩展详情（detail）</span>
            <el-button
              v-if="currentLog.detail"
              size="small"
              type="primary"
              link
              @click="copyDetail"
            >
              复制
            </el-button>
          </div>
          <pre v-if="currentLog.detail" class="json-block">{{ JSON.stringify(currentLog.detail, null, 2) }}</pre>
          <div v-else class="text-muted">无扩展信息</div>
        </div>
      </div>
    </el-drawer>
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
.text-muted {
  color: #c0c4cc;
}
.action-code {
  margin-left: 6px;
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 12px;
  color: #909399;
}
.detail-content {
  padding: 0 16px;
}
.detail-block {
  margin-top: 20px;
}
.block-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.block-title {
  font-weight: 600;
  color: #303133;
}
.json-block {
  background: #f5f7fa;
  padding: 12px;
  border-radius: 4px;
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: #303133;
  max-height: 320px;
  overflow: auto;
}
.ua-text {
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 12px;
  word-break: break-all;
  color: #606266;
}
</style>
