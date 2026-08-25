<!-- script setup 部分：使用组合式 API 和语法糖 -->
<script setup lang="ts">
// 从 vue 导入 ref 用于创建响应式数据，导入 onMounted 用于组件挂载后的生命周期钩子
import { ref, onMounted } from 'vue'
// 从 element-plus 导入 ElMessage 用于消息提示，导入 ElMessageBox 用于确认弹框
import { ElMessage, ElMessageBox } from 'element-plus'
// 导入用户相关的 API 方法（获取列表、强制下线、切换状态）和用户类型定义
import { getUserList, forceKick, toggleUserStatus, type User } from '@/api/user'
// 从共享模块导入日期格式化函数
import { formatDate } from '@project/shared'

// 创建用户列表的响应式数组，初始值为空数组
const users = ref<User[]>([])
// 创建 loading 状态的响应式变量，用于控制表格的加载状态
const loading = ref(false)

// 定义异步获取用户列表函数
async function fetchUsers() {
  // 设置 loading 状态为 true，显示表格加载动画
  loading.value = true
  // 使用 try-catch-finally 处理异步请求
  try {
    // 调用获取用户列表 API
    const res = await getUserList()
    // 将服务器返回的用户数据赋值给响应式 users 数组
    users.value = res.data
  } catch (e: any) {
    // 捕获异常，显示错误消息提示
    ElMessage.error(e.message || '获取用户列表失败')
  } finally {
    // 无论成功还是失败，都将 loading 状态重置为 false
    loading.value = false
  }
}

// 定义异步强制用户下线处理函数，接收用户 ID 和用户名为参数
async function handleKick(userId: number, username: string) {
  // 调试日志，输出点击事件参数
  console.log("点击了吗a",userId,username);
  // 弹出确认弹框，询问是否确定强制用户下线
  await ElMessageBox.confirm(`确定要强制用户「${username}」下线吗？`, '提示', {
    // 确认按钮文字
    confirmButtonText: '确定',
    // 取消按钮文字
    cancelButtonText: '取消',
    // 弹框类型为警告
    type: 'warning',
  })
  // 用户确认后，使用 try-catch 处理异步请求
  try {
    // 调用强制下线 API
    const res = await forceKick(userId)
    // 显示操作成功消息提示
    ElMessage.success(res.data.msg || '已强制下线')
  } catch (e: any) {
    // 捕获异常，显示错误消息
    ElMessage.error(e.message || '操作失败')
  }
}

// 定义异步切换用户状态处理函数，接收用户对象为参数
// 这里用 unknown 而非 any，再在函数体里类型守卫或断言，保证类型安全
async function handleToggleStatus(user: User) {
  // 根据当前状态判断操作类型：status 为 1 表示禁用，否则表示启用
  const action = user.status === 1 ? '禁用' : '启用'
  // 弹出确认弹框，询问是否确定执行对应操作
  await ElMessageBox.confirm(`确定要${action}用户「${user.username}」吗？`, '提示', {
    // 确认按钮文字
    confirmButtonText: '确定',
    // 取消按钮文字
    cancelButtonText: '取消',
    // 弹框类型为警告
    type: 'warning',
  })
  // 用户确认后，使用 try-catch 处理异步请求
  try {
    // 调用切换用户状态 API，传入用户 ID
    const res = await toggleUserStatus(user.id)
    // 显示操作成功消息提示
    ElMessage.success(res.data.msg || `已${action}用户「${user.username}」`)
    // 重新获取用户列表以刷新数据
    await fetchUsers()
  } catch (e: any) {
    // 捕获异常，显示错误消息
    ElMessage.error(e.message || '操作失败')
  }
}

// 组件挂载后的生命周期钩子
onMounted(() => {
  // 页面加载完成后自动获取用户列表数据
  fetchUsers()
})

</script>

<!-- 模板部分：定义用户管理页面的 HTML 结构 -->
<template>
  <!-- 用户管理页面外层容器 -->
  <div class="user-manage">
    <!-- Element Plus 卡片组件包裹表格 -->
    <el-card>
      <!-- Element Plus 表格组件，绑定用户数据，v-loading 显示加载动画，stripe 显示斑马纹 -->
      <el-table :data="users" v-loading="loading" stripe>
        <!-- ID 列，显示用户 ID，固定宽度 80px -->
        <el-table-column prop="id" label="ID" width="80" />
        <!-- 用户名列表，显示用户名 -->
        <el-table-column prop="username" label="用户名" />
        <!-- 创建时间列，使用自定义模板渲染，通过 formatDate 函数格式化时间戳 -->
        <el-table-column label="创建时间" width="180">
          <!-- 使用作用域插槽获取当前行数据 row -->
          <template #default="{ row }">
            <!-- 显示格式化后的创建时间 -->
            {{ formatDate(row.createTime) }}
          </template>
        </el-table-column>
        <!-- 状态列，使用自定义模板渲染 -->
        <el-table-column label="状态" width="100">
          <!-- 使用作用域插槽获取当前行数据 row -->
          <template #default="{ row }">
            <!-- 根据用户状态显示不同颜色的标签：1 为成功色(绿色)，0 为危险色(红色) -->
            <el-tag :type="row.status === 1 ? 'success' : 'danger'">
              <!-- 状态文字：1 显示"正常"，0 显示"禁用" -->
              {{ row.status === 1 ? '正常' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <!-- 操作列，固定宽度 200px -->
        <el-table-column label="操作" width="200">
          <!-- 使用作用域插槽获取当前行数据 row -->
          <template #default="{ row }">
            <!-- 强制下线按钮，警告色，小尺寸，点击时触发 handleKick 函数 -->
            <el-button type="warning" size="small" @click="handleKick(row.id, row.username)">
              强制下线
            </el-button>
            <!-- 启用/禁用按钮，根据当前状态动态切换按钮颜色和操作文字 -->
            <el-button
              :type="row.status === 1 ? 'danger' : 'success'"
              size="small"
              @click="handleToggleStatus(row as User)"
            >
              <!-- 按钮文字：状态为 1 显示"禁用"，否则显示"启用" -->
              {{ row.status === 1 ? '禁用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<!-- 样式部分：使用 SCSS 预处理，scoped 表示样式仅作用于当前组件 -->
<style lang="scss" scoped>
// 用户管理容器样式，设置 20px 内边距
.user-manage {
  padding: 20px;
}
</style>
