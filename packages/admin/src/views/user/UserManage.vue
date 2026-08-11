<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getUserList, forceKick, toggleUserStatus, type User } from '@/api/user'
import { formatDate } from '@project/shared'

const users = ref<User[]>([])
const loading = ref(false)

async function fetchUsers() {
  loading.value = true
  try {
    const res = await getUserList()
    users.value = res.data.data
  } catch (e: any) {
    ElMessage.error(e.message || '获取用户列表失败')
  } finally {
    loading.value = false
  }
}

async function handleKick(userId: number, username: string) {
  console.log("点击了吗a",userId,username);
  await ElMessageBox.confirm(`确定要强制用户「${username}」下线吗？`, '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  })
  try {
    const res = await forceKick(userId)
    ElMessage.success(res.data.data.msg || '已强制下线')
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
    ElMessage.success(res.data.data.msg || `已${action}用户「${user.username}」`)
    await fetchUsers()
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败')
  }
}

onMounted(() => {
  fetchUsers()
})

</script>

<template>
  <div class="user-manage">
    <el-card>
      <el-table :data="users" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="username" label="用户名" />
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
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
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
  </div>
</template>

<style lang="scss" scoped>
.user-manage {
  padding: 20px;
}
</style>
