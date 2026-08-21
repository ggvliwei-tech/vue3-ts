<!-- script setup 块：使用 Composition API 语法糖定义注册页面逻辑 -->
<script setup lang="ts">
// 从 vue 中导入 ref 函数，用于创建响应式数据
import { ref } from 'vue'
// 从 vue-router 中导入 useRouter 函数用于路由导航
import { useRouter } from 'vue-router'
// 从 vant 中导入 showToast 轻提示组件方法
import { showToast } from 'vant'
// 从用户 API 模块中导入 register 注册函数
import { register } from '@/api/user'

// 获取路由导航实例
const router = useRouter()

// 定义用户名输入框的响应式数据
const username = ref('')
// 定义密码输入框的响应式数据
const password = ref('')
// 定义确认密码输入框的响应式数据
const confirmPassword = ref('')
// 定义注册按钮加载状态的响应式数据
const loading = ref(false)

// 处理注册的异步函数
async function handleRegister() {
  // 检查用户名是否为空（去除首尾空格后）
  if (!username.value.trim()) {
    // 为空时弹出提示信息
    showToast('请输入用户名')
    // 阻止后续注册逻辑执行
    return
  }
  // 检查用户名长度是否在 2-20 位之间
  if (username.value.trim().length < 2 || username.value.trim().length > 20) {
    // 长度不符合时弹出提示信息
    showToast('用户名长度2-20位')
    // 阻止后续注册逻辑执行
    return
  }
  // 检查密码是否为空
  if (!password.value) {
    // 为空时弹出提示信息
    showToast('请输入密码')
    // 阻止后续注册逻辑执行
    return
  }
  // 检查两次输入的密码是否一致
  if (password.value !== confirmPassword.value) {
    // 不一致时弹出提示信息
    showToast('两次密码输入不一致')
    // 阻止后续注册逻辑执行
    return
  }

  // 开始注册请求，将按钮状态设为加载中
  loading.value = true
  // 使用 try-catch 捕获注册请求可能抛出的异常
  try {
    // 调用注册 API，传入去除空格的用户名和密码
    await register({
      username: username.value.trim(),
      password: password.value,
    })
    // 注册成功后弹出提示信息
    showToast('注册成功')
    // 跳转到登录页面
    router.push('/login')
  } catch (e: any) {
    // 注册失败时，弹出错误信息或默认提示
    showToast(e.message || '注册失败')
  } finally {
    // 无论成功还是失败，都将加载状态重置为 false
    loading.value = false
  }
}

// 跳转到登录页面的函数
function goLogin() {
  // 导航到登录页面路由
  router.push('/login')
}
</script>

<!-- template 模板块：定义注册页面的 HTML 结构 -->
<template>
  <!-- 注册页面外层容器 -->
  <div class="register-page">
    <!-- 注册页面头部区域 -->
    <div class="register-header">
      <!-- 注册标题 -->
      <h2>用户注册</h2>
    </div>

    <!-- Vant 表单组件，@submit 监听表单提交事件触发 handleRegister -->
    <van-form @submit="handleRegister">
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
        <!-- 确认密码输入字段，用于二次确认密码 -->
        <van-field
          v-model="confirmPassword"
          type="password"
          label="确认密码"
          placeholder="请再次输入密码"
          :rules="[{ required: true, message: '请再次输入密码' }]"
        />
      </van-cell-group>

      <!-- 注册按钮容器 -->
      <div class="register-btn-wrap">
        <!-- 注册提交按钮，type 主色调，block 撑满宽度，round 圆角 -->
        <van-button
          type="primary"
          block
          round
          native-type="submit"
          :loading="loading"
        >
          注册
        </van-button>
      </div>
    </van-form>

    <!-- 注册页面底部区域，提示登录链接 -->
    <div class="register-footer">
      <!-- 提示文字 -->
      <span>已有账号？</span>
      <!-- 点击跳转到登录页面的链接 -->
      <a @click="goLogin">去登录</a>
    </div>
  </div>
</template>

<!-- style 样式块：定义注册页面的局部样式 -->
<style lang="scss" scoped>
// 注册页面容器样式
.register-page {
  // 最小高度占满整个视口
  min-height: 100vh;
  // 背景色为浅灰色
  background-color: #f5f5f5;
  // 顶部留出 80px 内边距
  padding-top: 80px;
}

// 注册头部区域样式
.register-header {
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

// 注册按钮容器样式
.register-btn-wrap {
  // 上下 20px、左右 16px 的内边距
  padding: 20px 16px;
}

// 注册底部区域样式
.register-footer {
  // 文字居中对齐
  text-align: center;
  // 顶部外边距 20px
  margin-top: 20px;
  // 字体大小 14px
  font-size: 14px;
  // 字体颜色为浅灰色
  color: #999;

  // 登录链接样式
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
