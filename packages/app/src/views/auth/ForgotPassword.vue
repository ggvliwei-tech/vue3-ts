<!-- script setup 块：使用 Composition API 语法糖定义忘记密码页面逻辑 -->
<script setup lang="ts">
// 从 vue 中导入 ref（响应式数据）和 onUnmounted（组件卸载生命周期钩子）
import { ref, onUnmounted } from 'vue'
// 从 vue-router 中导入 useRouter 函数用于路由导航
import { useRouter } from 'vue-router'
// 从 vant 中导入轻提示、对话框组件方法
import { showToast, showDialog } from 'vant'
// 从用户 API 模块中导入 forgotPassword 函数
import { forgotPassword } from '@/api/user'
// 从短信 API 模块中导入 sendCode 函数
import { sendCode } from '@/api/sms'

// 获取路由导航实例
const router = useRouter()

// 定义手机号输入框的响应式数据
const phone = ref('')
// 定义验证码输入框的响应式数据
const code = ref('')
// 定义新密码输入框的响应式数据
const newPassword = ref('')
// 定义确认密码输入框的响应式数据
const confirmPassword = ref('')
// 定义提交按钮加载状态的响应式数据
const loading = ref(false)
// 定义发送验证码按钮加载状态
const sending = ref(false)
// 定义倒计时秒数（0 表示未开始或已结束）
const countdown = ref(0)
// 保存倒计时定时器引用，用于组件卸载时清理
let timer: ReturnType<typeof setInterval> | null = null

// 组件卸载时清理定时器，防止内存泄漏
onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})

// 校验手机号格式
function isValidPhone(value: string) {
  return /^1[3-9]\d{9}$/.test(value)
}

// 发送验证码的异步函数
async function handleSendCode() {
  // 校验手机号是否为空
  if (!phone.value.trim()) {
    showToast('请输入手机号')
    return
  }
  // 校验手机号格式
  if (!isValidPhone(phone.value.trim())) {
    showToast('手机号格式不正确')
    return
  }
  // 如果已经在倒计时中，不允许重复发送
  if (countdown.value > 0) return

  // 开始发送请求，将发送按钮设为加载中
  sending.value = true
  try {
    // 调用发送验证码 API
    const res = await sendCode(phone.value.trim())
    showToast(res.msg || '验证码已发送')
    // 启动倒计时（60 秒）
    countdown.value = 60
    timer = setInterval(() => {
      countdown.value--
      if (countdown.value <= 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    }, 1000)
  } catch (e: any) {
    showToast(e.message || '发送失败')
  } finally {
    // 无论成功还是失败，都将发送按钮状态重置
    sending.value = false
  }
}

// 处理重置密码的异步函数
async function handleReset() {
  // 校验手机号
  if (!phone.value.trim()) {
    showToast('请输入手机号')
    return
  }
  if (!isValidPhone(phone.value.trim())) {
    showToast('手机号格式不正确')
    return
  }
  // 校验验证码
  if (!code.value.trim()) {
    showToast('请输入验证码')
    return
  }
  if (code.value.trim().length !== 6) {
    showToast('验证码为 6 位数字')
    return
  }
  // 校验新密码
  if (!newPassword.value) {
    showToast('请输入新密码')
    return
  }
  if (newPassword.value.length < 6) {
    showToast('密码长度至少 6 位')
    return
  }
  // 校验两次密码是否一致
  if (newPassword.value !== confirmPassword.value) {
    showToast('两次密码输入不一致')
    return
  }

  // 二次确认弹窗
  try {
    await showDialog({
      title: '确认重置',
      message: '重置密码后需要重新登录，确定继续吗？',
      showCancelButton: true,
    })
  } catch {
    return // 用户取消
  }

  // 开始重置请求，将按钮状态设为加载中
  loading.value = true
  try {
    const res = await forgotPassword({
      phone: phone.value.trim(),
      code: code.value.trim(),
      newPassword: newPassword.value,
    })
    showToast(res.msg || '密码重置成功')
    // 重置成功后跳转到登录页
    router.push('/login')
  } catch (e: any) {
    showToast(e.message || '重置失败')
  } finally {
    loading.value = false
  }
}

// 跳转到登录页
function goLogin() {
  router.push('/login')
}
</script>

<!-- template 模板块：定义忘记密码页面的 HTML 结构 -->
<template>
  <div class="forgot-page">
    <!-- Vant 导航栏，左侧返回箭头 -->
    <van-nav-bar title="找回密码" left-arrow @click-left="goLogin" />

    <div class="forgot-header">
      <h2>忘记密码</h2>
      <p class="hint">通过注册时的手机号验证后重置密码</p>
    </div>

    <!-- Vant 表单组件，@submit 监听表单提交事件触发 handleReset -->
    <van-form @submit="handleReset">
      <van-cell-group inset>
        <!-- 手机号输入字段 -->
        <van-field
          v-model="phone"
          label="手机号"
          placeholder="请输入注册时的手机号"
          type="tel"
          maxlength="11"
          :rules="[
            { required: true, message: '请输入手机号' },
            { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' },
          ]"
        />
        <!-- 验证码输入字段（右侧带发送按钮） -->
        <van-field
          v-model="code"
          label="验证码"
          placeholder="请输入 6 位验证码"
          maxlength="6"
          :rules="[{ required: true, message: '请输入验证码' }]"
        >
          <template #button>
            <van-button
              size="small"
              type="primary"
              plain
              :loading="sending"
              :disabled="countdown > 0"
              @click="handleSendCode"
            >
              {{ countdown > 0 ? `${countdown}s 后重试` : '发送验证码' }}
            </van-button>
          </template>
        </van-field>
        <!-- 新密码输入字段 -->
        <van-field
          v-model="newPassword"
          type="password"
          label="新密码"
          placeholder="请输入新密码（至少 6 位）"
          :rules="[{ required: true, message: '请输入新密码' }]"
        />
        <!-- 确认新密码输入字段 -->
        <van-field
          v-model="confirmPassword"
          type="password"
          label="确认密码"
          placeholder="请再次输入新密码"
          :rules="[{ required: true, message: '请再次输入新密码' }]"
        />
      </van-cell-group>

      <!-- 重置密码按钮容器 -->
      <div class="forgot-btn-wrap">
        <van-button
          type="primary"
          block
          round
          native-type="submit"
          :loading="loading"
        >
          重置密码
        </van-button>
      </div>
    </van-form>
  </div>
</template>

<!-- style 样式块：定义忘记密码页面的局部样式 -->
<style lang="scss" scoped>
.forgot-page {
  min-height: 100vh;
  background-color: #f5f5f5;
}

.forgot-header {
  text-align: center;
  margin: 30px 16px;

  h2 {
    font-size: 28px;
    color: #333;
    margin: 0 0 12px;
  }

  .hint {
    font-size: 14px;
    color: #999;
    margin: 0;
  }
}

.forgot-btn-wrap {
  padding: 20px 16px;
}
</style>