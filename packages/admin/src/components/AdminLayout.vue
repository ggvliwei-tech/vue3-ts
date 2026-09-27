<!-- script setup 部分：使用组合式 API 和语法糖 -->
<script setup lang="ts">
// 从 vue 导入 computed 用于创建计算属性
import { computed } from 'vue'
// 从 vue-router 导入 useRouter 用于程序化导航
import { useRouter } from 'vue-router'
// 从 element-plus 导入 ElMessage 用于显示消息提示
import { ElMessage } from 'element-plus'
// 从 element-plus 图标库显式导入需要的图标
import { Monitor, UserFilled, User, Avatar, Key, Document, Setting } from '@element-plus/icons-vue'
// 导入用户相关的 API 方法，此处使用 logout 退出登录
import { logout } from '@/api/user'
// 认证状态与统一登出清理
import { useAuthStore } from '@project/shared/stores/useAuthStore'
import { notifyLogout } from '@project/shared/token-refresh'

// 获取路由器实例
const router = useRouter()
// 认证 store：用户名等展示信息与登录态同源
const authStore = useAuthStore()

// 用户名直接读 store，不再依赖 localStorage 里的平铺副本
// （那份副本与真实登录态互相独立，容易出现"已登出却仍显示旧用户名"）
const currentUsername = computed(() => authStore.userInfo?.username ?? '未登录')

// 定义异步退出登录处理函数
async function handleLogout() {
  try {
    // 调用后端退出登录 API，吊销 refresh token 并销毁该设备会话
    await logout()
  } catch {
    // 服务端登出失败（网络异常 / 会话已失效）不应阻止本地登出
  }
  // 统一清理本地认证状态，其他标签页通过 storage 事件一并登出
  notifyLogout()
  // 显示退出成功消息提示
  ElMessage.success('退出成功')
  // 跳转到登录页面
  router.push('/login')
}
</script>

<!-- 模板部分：定义管理后台布局的 HTML 结构 -->
<template>
  <!-- 使用 Element Plus 的 Container 容器组件，作为整体布局容器 -->
  <el-container class="admin-layout">
    <!-- 侧边栏区域，固定宽度 220px -->
    <el-aside width="220px" class="admin-aside">
      <!-- Logo 区域，显示"管理后台"文字 -->
      <div class="logo">管理后台</div>
      <!-- Element Plus 菜单组件，default-active 绑定当前路由路径以高亮对应菜单项 -->
      <el-menu
        :default-active="$route.path"
        router
        background-color="#304156"
        text-color="#bfcbd9"
        active-text-color="#409eff"
      >
        <!-- 仪表盘菜单项，点击跳转到 /dashboard -->
        <el-menu-item index="/dashboard">
          <!-- Monitor 图标 -->
          <el-icon><Monitor /></el-icon>
          <!-- 菜单文字 -->
          <span>仪表盘</span>
        </el-menu-item>

        <!-- 业务管理分组 -->
        <el-sub-menu index="biz">
          <template #title>
            <el-icon><UserFilled /></el-icon>
            <span>业务管理</span>
          </template>
          <el-menu-item index="/users">
            <el-icon><Avatar /></el-icon>
            <span>用户管理</span>
          </el-menu-item>
        </el-sub-menu>

        <!-- 系统管理分组 -->
        <el-sub-menu index="system">
          <template #title>
            <el-icon><Setting /></el-icon>
            <span>系统管理</span>
          </template>
          <el-menu-item index="/roles">
            <el-icon><User /></el-icon>
            <span>角色管理</span>
          </el-menu-item>
          <el-menu-item index="/permissions">
            <el-icon><Key /></el-icon>
            <span>权限管理</span>
          </el-menu-item>
          <el-menu-item index="/audit">
            <el-icon><Document /></el-icon>
            <span>审计日志</span>
          </el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-aside>

    <!-- 右侧主内容区容器 -->
    <el-container>
      <!-- 顶部导航栏 -->
      <el-header class="admin-header">
        <!-- 显示当前路由的 meta.title 作为页面标题 -->
        <span class="header-title">{{ $route.meta.title }}</span>
        <!-- 右侧操作区：当前登录人 + 退出登录按钮 -->
        <div class="header-right">
          <!-- 当前登录人区域，使用 Element Plus 的 dropdown 风格展示（这里简化为文字+图标） -->
          <span class="current-user">
            <!-- Element Plus 的 User 图标 -->
            <el-icon><User /></el-icon>
            <!-- 显示用户名（来自 AuthStore.userInfo，见本文件 script 里的 currentUsername） -->
            <span class="username-text">{{ currentUsername }}</span>
          </span>
          <!-- 退出登录按钮，点击时触发 handleLogout 函数 -->
          <el-button type="danger" size="small" @click="handleLogout">退出登录</el-button>
        </div>
      </el-header>

      <!-- 主内容区域 -->
      <el-main class="admin-main">
        <!-- router-view 渲染当前路由匹配到的子页面组件 -->
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<!-- 样式部分：使用 SCSS 预处理，scoped 表示样式仅作用于当前组件 -->
<style lang="scss" scoped>
// 布局容器，最小高度为视口高度
.admin-layout {
  min-height: 100vh;
}

// 侧边栏样式，设置背景色和最小高度
.admin-aside {
  background-color: #304156;
  min-height: 100vh;
}

// Logo 区域样式，设置高度、居中、文字样式和背景色
.logo {
  height: 60px;
  line-height: 60px;
  text-align: center;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  background-color: #263445;
}

// 顶部导航栏样式，使用 flexbox 两端对齐
.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid #e6e6e6;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

// 顶部标题文字样式
.header-title {
  font-size: 16px;
  font-weight: 500;
  color: #333;
}

// 顶部右侧操作区容器，使用 flexbox 让用户名和按钮水平排列并垂直居中
.header-right {
  display: flex;
  align-items: center;
  gap: 16px; // 子项之间留 16px 间距
}

// 当前登录人区域样式：图标 + 用户名
.current-user {
  display: flex;
  align-items: center;
  gap: 6px; // 图标和文字之间间距
  font-size: 14px;
  color: #606266;

  // 用户名文字样式
  .username-text {
    font-weight: 500;
    // 限制最大宽度，超出省略号显示，避免长用户名撑爆布局
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

// 主内容区域样式，设置浅灰色背景
.admin-main {
  background: #f0f2f5;
}
</style>
