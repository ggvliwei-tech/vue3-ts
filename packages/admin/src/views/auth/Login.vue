<!-- script setup 部分：使用组合式 API 和语法糖 -->
<script setup lang="ts">
// 从 vue 导入 ref 用于创建响应式数据
import { ref } from 'vue'
// 从 vue-router 导入 useRouter 和 useRoute 用于导航和获取当前路由信息
import { useRouter, useRoute } from 'vue-router'
// 从 element-plus 导入 ElMessage 用于显示消息提示
import { ElMessage } from 'element-plus'
// 导入 Element Plus 的表单实例类型，用于表单验证
import type { FormInstance } from 'element-plus'
// 导入用户相关的 API 方法，此处使用 login 登录
import { login } from '@/api/user'
// M1：使用 Pinia store 统一管理 token / userInfo
import { useAuthStore } from '@project/shared/stores/useAuthStore'

// 获取路由器实例，用于页面跳转
const router = useRouter()
// 获取当前路由实例，用于获取路由参数（如 redirect）
const route = useRoute()
// 创建表单实例的 ref 引用，用于调用表单验证方法
const formRef = ref<FormInstance>()
// 认证 store（M1）
const authStore = useAuthStore()

// 创建表单数据的响应式对象，包含用户名和密码字段
const form = ref({
  // 用户名初始值为空字符串
  username: '',
  // 密码初始值为空字符串
  password: '',
})
// 创建 loading 状态的响应式变量，用于控制登录按钮的加载状态
const loading = ref(false)

// 定义表单验证规则
const rules = {
  // 用户名必填规则，失焦时触发验证
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  // 密码必填规则，失焦时触发验证
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

// 定义异步登录处理函数
async function handleLogin() {
  // 调用表单验证方法，验证失败时返回 false
  const valid = await formRef.value?.validate().catch(() => false)
  // 如果验证不通过，直接返回不再执行后续逻辑
  if (!valid) return

  // 设置 loading 状态为 true，显示按钮加载动画
  loading.value = true
  // 使用 try-catch-finally 处理异步请求
  try {
    // 调用登录 API，传入用户名（去除首尾空格）和密码
    const res = await login({
      username: form.value.username.trim(),
      password: form.value.password,
    })
    // M1：统一写入 AuthStore（同时持久化到 sessionStorage）
    // 旧的 localStorage 'token' / 'username' / 'roles' / 'permissions' 全部废弃
    authStore.login({
      accessToken: res.data.accessToken,
      userInfo: {
        id: res.data.userInfo.id,
        username: res.data.userInfo.username,
        status: res.data.userInfo.status,
        roles: res.data.userInfo.roles ?? [],
        permissions: res.data.userInfo.permissions ?? [],
      },
    })
    // 兼容旧读取方：仍然写一份到 localStorage（避免 AdminLayout 等老代码读取 'username' / 'roles' 时崩溃）
    localStorage.setItem('token', res.data.accessToken)
    localStorage.setItem('username', res.data.userInfo.username)
    localStorage.setItem('roles', JSON.stringify(res.data.userInfo.roles ?? []))
    localStorage.setItem('permissions', JSON.stringify(res.data.userInfo.permissions ?? []))
    // 显示登录成功消息提示
    ElMessage.success('登录成功')
    // 跳转到之前页面或默认的仪表盘页面
    router.push((route.query.redirect as string) || '/dashboard')
  } catch (e: any) {
    // 捕获登录异常，显示错误消息
    ElMessage.error(e.message || '登录失败')
  } finally {
    // 无论成功还是失败，都将 loading 状态重置为 false
    loading.value = false
  }
}
</script>

<!-- 模板部分：定义登录页面的 HTML 结构 -->
<template>
  <!-- 登录页面外层容器，用于居中和背景 -->
  <div class="login-page">
    <!-- 登录卡片容器 -->
    <div class="login-card">
      <!-- 登录标题 -->
      <h2 class="login-title">管理后台登录</h2>
      <!-- Element Plus 表单组件，绑定表单数据、验证规则和提交事件 -->
      <el-form ref="formRef" :model="form" :rules="rules" @submit.prevent="handleLogin">
        <!-- 用户名表单项，绑定 prop 用于验证 -->
        <el-form-item prop="username">
          <!-- 用户名输入框，双向绑定表单数据，设置大尺寸和用户图标前缀 -->
          <el-input
            v-model="form.username"
            placeholder="请输入用户名"
            size="large"
            prefix-icon="User"
          />
        </el-form-item>
        <!-- 密码表单项，绑定 prop 用于验证 -->
        <el-form-item prop="password">
          <!-- 密码输入框，双向绑定表单数据，类型为密码，大尺寸，锁定图标前缀，显示密码切换按钮 -->
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            size="large"
            prefix-icon="Lock"
            show-password
          />
        </el-form-item>
        <!-- 登录按钮表单项 -->
        <el-form-item>
          <!-- 登录按钮，主色调，大尺寸，绑定 loading 状态，原生类型为 submit -->
          <el-button
            type="primary"
            size="large"
            :loading="loading"
            class="login-btn"
            native-type="submit"
          >
            登录
          </el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<!-- 样式部分：使用 SCSS 预处理，scoped 表示样式仅作用于当前组件 -->
<style lang="scss" scoped>
// 登录页面容器样式，最小高度为视口高度，使用 flexbox 垂直水平居中
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

// 登录卡片样式，固定宽度，内边距，白色背景，圆角和阴影
.login-card {
  width: 400px;
  padding: 40px 36px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}

// 登录标题样式，居中对齐，字体大小和颜色，下边距
.login-title {
  text-align: center;
  font-size: 24px;
  color: #333;
  margin: 0 0 32px;
}

// 登录按钮样式，宽度占满父容器
.login-btn {
  width: 100%;
}
</style>
