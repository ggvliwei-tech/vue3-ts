<!-- script setup 部分：使用组合式 API 和语法糖 -->
<script setup lang="ts">
// 从 vue-router 导入 useRouter 用于程序化导航
import { useRouter } from 'vue-router'
// 从 element-plus 导入 ElMessage 用于显示消息提示
import { ElMessage } from 'element-plus'
// 导入用户相关的 API 方法，此处使用 logout 退出登录
import { logout } from '@/api/user'

// 获取路由器实例
const router = useRouter()

// 定义异步退出登录处理函数
async function handleLogout() {
  // 使用 try-catch 包裹异步操作
  try {
    // 调用后端退出登录 API
    await logout()
    // 清除本地存储的 token
    localStorage.removeItem('token')
    // 显示退出成功消息提示
    ElMessage.success('退出成功')
    // 跳转到登录页面
    router.push('/login')
  } catch (e: any) {
    // 即使接口调用失败，也清除本地 token 并跳转登录页
    localStorage.removeItem('token')
    router.push('/login')
  }
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
        <!-- 用户管理菜单项，点击跳转到 /users -->
        <el-menu-item index="/users">
          <!-- UserFilled 图标 -->
          <el-icon><UserFilled /></el-icon>
          <!-- 菜单文字 -->
          <span>用户管理</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <!-- 右侧主内容区容器 -->
    <el-container>
      <!-- 顶部导航栏 -->
      <el-header class="admin-header">
        <!-- 显示当前路由的 meta.title 作为页面标题 -->
        <span class="header-title">{{ $route.meta.title }}</span>
        <!-- 退出登录按钮，点击时触发 handleLogout 函数 -->
        <el-button type="danger" size="small" @click="handleLogout">退出登录</el-button>
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

// 主内容区域样式，设置浅灰色背景
.admin-main {
  background: #f0f2f5;
}
</style>
