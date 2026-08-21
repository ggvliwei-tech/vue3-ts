<!-- script setup 块：使用 Composition API 语法糖定义登录页面逻辑 -->
<script setup lang="ts">
// 从 vue 中导入 ref 函数，用于创建响应式数据
import { ref } from 'vue'
// 从 vue-router 中导入 useRouter（路由导航）和 useRoute（当前路由信息）函数
import { useRouter, useRoute } from 'vue-router'
// 从 vant 中导入 showToast 轻提示组件方法
import { showToast } from 'vant'
// 从用户 API 模块中导入 login 登录函数
import { login } from '@/api/user'

// 获取路由导航实例
const router = useRouter()
// 获取当前路由信息对象
const route = useRoute()

// 定义用户名输入框的响应式数据
const username = ref('')
// 定义密码输入框的响应式数据
const password = ref('')
// 定义登录按钮加载状态的响应式数据
const loading = ref(false)

// 处理登录的异步函数
async function handleLogin() {
  // 检查用户名是否为空（去除首尾空格后）
  if (!username.value.trim()) {
    // 为空时弹出提示信息
    showToast('请输入用户名')
    // 阻止后续登录逻辑执行
    return
  }
  // 检查密码是否为空
  if (!password.value) {
    // 为空时弹出提示信息
    showToast('请输入密码')
    // 阻止后续登录逻辑执行
    return
  }

  // 开始登录请求，将按钮状态设为加载中
  loading.value = true
  // 使用 try-catch 捕获登录请求可能抛出的异常
  try {
    // 调用登录 API，传入去除空格的用户名和密码
    const res = await login({
      username: username.value.trim(),
      password: password.value,
    })
    // 登录成功后，将服务器返回的 accessToken 存储到 localStorage 中
    localStorage.setItem('token', res.data.accessToken)
    // 弹出登录成功提示
    showToast('登录成功')
    // 跳转到登录前试图访问的页面，如果没有则默认跳转到首页
    router.push((route.query.redirect as string) || '/home')
  } catch (e: any) {
    // 登录失败时，弹出错误信息或默认提示
    showToast(e.message || '登录失败')
  } finally {
    // 无论成功还是失败，都将加载状态重置为 false
    loading.value = false
  }
}

// 跳转到注册页面的函数
function goRegister() {
  // 导航到注册页面路由
  router.push('/register')
}
</script>

<!-- template 模板块：定义登录页面的 HTML 结构 -->
<template>
  <!-- 登录页面外层容器 -->
  <div class="login-page">
    <!-- 登录页面头部区域 -->
    <div class="login-header">
      <!-- 登录标题 -->
      <h2>用户登录</h2>
    </div>

    <!-- Vant 表单组件，@submit 监听表单提交事件触发 handleLogin -->
    <van-form @submit="handleLogin">
      <!-- Vant 单元格组，inset 属性使卡片内缩显示 -->
      <van-cell-group inset>
        <!-- 用户名输入字段，v-model 双向绑定用户名数据 -->
        <van-field
          v-model="username"
          label="用户名"
          placeholder="请输入用户名"
          :rules="[{ required: true, message: '请输入用户名' }]"
        />
        <!-- 密码输入字段，type 为 password 隐藏输入内容 -->
        <van-field
          v-model="password"
          type="password"
          label="密码"
          placeholder="请输入密码"
          :rules="[{ required: true, message: '请输入密码' }]"
        />
      </van-cell-group>

      <!-- 登录按钮容器 -->
      <div class="login-btn-wrap">
        <!-- 登录提交按钮，type 主色调，block 撑满宽度，round 圆角 -->
        <van-button
          type="primary"
          block
          round
          native-type="submit"
          :loading="loading"
        >
          登录
        </van-button>
      </div>
    </van-form>

    <!-- 登录页面底部区域，提示注册链接 -->
    <div class="login-footer">
      <!-- 提示文字 -->
      <span>还没有账号？</span>
      <!-- 点击跳转到注册页面的链接 -->
      <a @click="goRegister">去注册</a>
    </div>
  </div>
</template>

<!-- style 样式块：定义登录页面的局部样式 -->
<style lang="scss" scoped>
// 登录页面容器样式
.login-page {
  // 最小高度占满整个视口
  min-height: 100vh;
  // 背景色为浅灰色
  background-color: #f5f5f5;
  // 顶部留出 80px 内边距
  padding-top: 80px;
}

// 登录头部区域样式
.login-header {
  // 文字居中对齐
  text-align: center;
  // 底部外边距 30px
  margin-bottom: 30px;

  // 标题 h2 样式
  h2 {
    // 字体大小 28px
    font-size: 28px;
    // 字体颜色为深灰色
    color: #333;
  }
}

// 登录按钮容器样式
.login-btn-wrap {
  // 上下 20px、左右 16px 的内边距
  padding: 20px 16px;
}

// 登录底部区域样式
.login-footer {
  // 文字居中对齐
  text-align: center;
  // 顶部外边距 20px
  margin-top: 20px;
  // 字体大小 14px
  font-size: 14px;
  // 字体颜色为浅灰色
  color: #999;

  // 注册链接样式
  a {
    // 链接颜色为主题蓝色
    color: #1989fa;
    // 左侧间距 4px
    margin-left: 4px;
    // 鼠标悬停时显示手型指针
    cursor: pointer;
  }
}
</style>
