<script setup lang="ts">
/**
 * 用户管理页（增强版）
 * - 列表 / 强制下线 / 启停 / 分配角色
 * - 权限码：user:list / user:kick / user:toggle-status / user-role:assign
 */
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getUserList, forceKick, toggleUserStatus, type User } from '@/api/user'
import { getUserRoles, assignUserRoles, type RoleBrief } from '@/api/user-role'
import { listEnabledRoles, type Role } from '@/api/role'
import { formatDate } from '@project/shared'

// ========== 列表状态 ==========
const users = ref<User[]>([])
const loading = ref(false)

// ========== 分配角色对话框 ==========
const assignDialogVisible = ref(false)
const assignLoading = ref(false)
const assignSubmitting = ref(false)
const currentUser = ref<User | null>(null)
const allRoles = ref<Role[]>([])
const currentRoles = ref<RoleBrief[]>([])
const checkedRoleIds = ref<number[]>([])

async function fetchUsers() {
  loading.value = true
  try {
    const res = await getUserList()
    users.value = res.data
  } catch (e: any) {
    ElMessage.error(e.message || '获取用户列表失败')
  } finally {
    loading.value = false
  }
}

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
    await fetchUsers()
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

onMounted(fetchUsers)
</script>

<template>
  <div class="user-manage">
    <el-card>
      <el-table :data="users" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="username" label="用户名" />
        <el-table-column prop="phone" label="手机号" width="140" />
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.createTime) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'">
              {{ row.status === 1 ? '正常' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="handleAssignRoles(row)">
              分配角色
            </el-button>
            <el-button type="warning" size="small" @click="handleKick(row.id, row.username)">
              强制下线
            </el-button>
            <el-button
              :type="row.status === 1 ? 'danger' : 'success'"
              size="small"
              @click="handleToggleStatus(row)"
            >
              {{ row.status === 1 ? '禁用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
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
