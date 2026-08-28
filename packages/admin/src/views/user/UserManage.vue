<script setup lang="ts">
/**
 * 用户管理页（分页 + 筛选 + 角色列）
 * - 列表 / 强制下线 / 启停 / 分配角色
 * - 筛选：keyword（用户名模糊） + status（1 正常 / 0 禁用 / 不选全部）
 * - 列表项附加 roles[] 字段（后端单 SQL 批量聚合）
 * - 权限码：user:list / user:kick / user:toggle-status / user-role:assign
 *
 * 列表状态由 usePagedList 接管：list / total / loading / currentPage / pageSize / searchKeyword / reload
 * 搜索关键词变更时 usePagedList 内部 watch 自动重置到第 1 页并 reload
 */
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getUserList, forceKick, toggleUserStatus, type User } from '@/api/user'
import { getUserRoles, assignUserRoles, type RoleBrief } from '@/api/user-role'
import { listEnabledRoles, type Role } from '@/api/role'
import { formatDate } from '@project/shared'
import { usePagedList, type PageQuery } from '@/composables/usePagedList'

// ========== 筛选条件（status 双向独立：null/'' = 全部） ==========
const statusFilter = ref<'' | 0 | 1>('')

// ========== 列表状态（usePagedList 接管，自动首次加载） ==========
const {
  list: users,
  total,
  loading,
  currentPage,
  pageSize,
  searchKeyword,
  reload,
} = usePagedList<User>({
  pageSize: 20, // 与后端 QueryUserListDto 默认一致
  fetcher: async (q: PageQuery) => {
    const res = await getUserList({
      page: q.page,
      pageSize: q.pageSize,
      keyword: q.keyword,
      status: statusFilter.value === '' ? undefined : statusFilter.value,
    })
    return res.data
  },
})

// ========== 分配角色对话框 ==========
const assignDialogVisible = ref(false)
const assignLoading = ref(false)
const assignSubmitting = ref(false)
const currentUser = ref<User | null>(null)
const allRoles = ref<Role[]>([])
const currentRoles = ref<RoleBrief[]>([])
const checkedRoleIds = ref<number[]>([])

async function handleKick(userId: number, username: string) {
  await ElMessageBox.confirm(`确定要强制用户「${username}」下线吗？`, '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  })
  try {
    const res = await forceKick(userId)
    ElMessage.success(res.data.msg || '已强制下线')
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败')
  }
}

async function handleToggleStatus(user: User) {
  const action = user.status === 1 ? '禁用' : '启用'
  await ElMessageBox.confirm(`确定要${action}用户「${user.username}」吗？`, '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  })
  try {
    const res = await toggleUserStatus(user.id)
    ElMessage.success(res.data.msg || `已${action}用户「${user.username}」`)
    // 启停改变了列表项 status，刷新当前页
    await reload()
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败')
  }
}

/** 打开分配角色对话框 */
async function handleAssignRoles(user: User) {
  currentUser.value = user
  assignDialogVisible.value = true
  assignLoading.value = true
  try {
    // 并发：全量角色 + 用户当前角色
    const [rolesRes, userRolesRes] = await Promise.all([
      listEnabledRoles(),
      getUserRoles(user.id),
    ])
    allRoles.value = rolesRes.data
    currentRoles.value = userRolesRes.data.roles
    checkedRoleIds.value = userRolesRes.data.roles.map((r) => r.id)
  } catch (e: any) {
    ElMessage.error(e.message || '加载角色数据失败')
    assignDialogVisible.value = false
  } finally {
    assignLoading.value = false
  }
}

/** 提交角色分配 */
async function handleSubmitAssign() {
  if (!currentUser.value) return
  assignSubmitting.value = true
  try {
    await assignUserRoles(currentUser.value.id, checkedRoleIds.value)
    ElMessage.success('角色分配成功')
    assignDialogVisible.value = false
  } catch (e: any) {
    ElMessage.error(e.message || '角色分配失败')
  } finally {
    assignSubmitting.value = false
  }
}
</script>

<template>
  <div class="user-manage">
    <el-card>
      <!-- 筛选工具栏 -->
      <div class="filter-bar">
        <el-input
          v-model="searchKeyword"
          placeholder="按用户名搜索"
          clearable
          style="width: 240px"
          @keyup.enter="reload"
        >
          <template #prefix>
            <span>🔍</span>
          </template>
        </el-input>
        <el-select
          v-model="statusFilter"
          placeholder="状态"
          clearable
          style="width: 140px"
          @change="reload"
        >
          <el-option label="全部" :value="''" />
          <el-option label="正常" :value="1" />
          <el-option label="禁用" :value="0" />
        </el-select>
        <el-button type="primary" @click="reload">查询</el-button>
      </div>

      <el-table :data="users" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="username" label="用户名" />
        <el-table-column label="角色" min-width="180">
          <template #default="{ row }">
            <template v-if="(row as User).roles && (row as User).roles!.length">
              <el-tag
                v-for="r in (row as User).roles"
                :key="r"
                type="primary"
                size="small"
                style="margin-right: 6px"
              >
                {{ r }}
              </el-tag>
            </template>
            <span v-else class="role-empty">—</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDate((row as User).createTime) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="(row as User).status === 1 ? 'success' : 'danger'">
              {{ (row as User).status === 1 ? '正常' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="handleAssignRoles(row as User)">
              分配角色
            </el-button>
            <el-button type="warning" size="small" @click="handleKick((row as User).id, (row as User).username)">
              强制下线
            </el-button>
            <el-button
              :type="(row as User).status === 1 ? 'danger' : 'success'"
              size="small"
              @click="handleToggleStatus(row as User)"
            >
              {{ (row as User).status === 1 ? '禁用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页器：与 usePagedList 双向绑定，翻页自动 reload -->
      <el-pagination
        class="pagination"
        :current-page="currentPage"
        :page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        background
        @current-change="(p: number) => (currentPage = p)"
        @size-change="(s: number) => (pageSize = s)"
      />
    </el-card>

    <!-- 分配角色对话框 -->
    <el-dialog
      v-model="assignDialogVisible"
      :title="`分配角色 - ${currentUser?.username || ''}`"
      width="560px"
      :close-on-click-modal="false"
    >
      <div v-loading="assignLoading">
        <el-alert
          type="info"
          :closable="false"
          title="提示：勾选要授予该用户的角色，全量替换现有角色；保存后该用户需要重新登录权限才会生效"
          style="margin-bottom: 16px"
        />
        <div class="current-roles" v-if="currentRoles.length">
          <span class="label">当前角色：</span>
          <el-tag
            v-for="r in currentRoles"
            :key="r.id"
            :type="r.status === 1 ? 'primary' : 'info'"
            size="small"
            style="margin-right: 6px"
          >
            {{ r.name }}
          </el-tag>
        </div>
        <el-checkbox-group v-model="checkedRoleIds" class="role-checkboxes">
          <el-checkbox
            v-for="r in allRoles"
            :key="r.id"
            :value="r.id"
            :disabled="r.status === 0"
            class="role-item"
          >
            <span class="role-code">{{ r.code }}</span>
            <span class="role-name">{{ r.name }}</span>
            <el-tag v-if="r.status === 0" type="info" size="small" style="margin-left: 6px">
              已禁用
            </el-tag>
          </el-checkbox>
        </el-checkbox-group>
      </div>
      <template #footer>
        <el-button @click="assignDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="assignSubmitting" @click="handleSubmitAssign">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
.user-manage {
  padding: 20px;
}
.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
.role-empty {
  color: #c0c4cc;
}
.current-roles {
  margin-bottom: 12px;
  font-size: 13px;
  color: #606266;
  .label {
    color: #909399;
    margin-right: 6px;
  }
}
.role-checkboxes {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
}
.role-item {
  margin-right: 0 !important;
}
.role-code {
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 12px;
  color: #409eff;
  margin-right: 8px;
}
.role-name {
  color: #303133;
}
</style>
