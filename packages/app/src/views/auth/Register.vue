<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { register } from '@/api/user'

const router = useRouter()

const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)

async function handleRegister() {
  if (!username.value.trim()) {
    showToast('请输入用户名')
    return
  }
  if (username.value.trim().length < 2 || username.value.trim().length > 20) {
    showToast('用户名长度2-20位')
    return
  }
  if (!password.value) {
    showToast('请输入密码')
    return
  }
  if (password.value !== confirmPassword.value) {
    showToast('两次密码输入不一致')
    return
  }

  loading.value = true
  try {
    await register({
      username: username.value.trim(),
      password: password.value,
    })
    showToast('注册成功')
    router.push('/login')
  } catch (e: any) {
    showToast(e.message || '注册失败')
  } finally {
    loading.value = false
  }
}

function goLogin() {
  router.push('/login')
}
</script>

<template>
  <div class="register-page">
    <div class="register-header">
      <h2>用户注册</h2>
    </div>

    <van-form @submit="handleRegister">
      <van-cell-group inset>
        <van-field
          v-model="username"
          label="用户名"
          placeholder="请输入用户名"
          :rules="[{ required: true, message: '请输入用户名' }]"
        />
        <van-field
          v-model="password"
          type="password"
          label="密码"
          placeholder="请输入密码"
          :rules="[{ required: true, message: '请输入密码' }]"
        />
        <van-field
          v-model="confirmPassword"
          type="password"
          label="确认密码"
          placeholder="请再次输入密码"
          :rules="[{ required: true, message: '请再次输入密码' }]"
        />
      </van-cell-group>

      <div class="register-btn-wrap">
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

    <div class="register-footer">
      <span>已有账号？</span>
      <a @click="goLogin">去登录</a>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.register-page {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding-top: 80px;
}

.register-header {
  text-align: center;
  margin-bottom: 30px;

  h2 {
    font-size: 28px;
    color: #333;
  }
}

.register-btn-wrap {
  padding: 20px 16px;
}

.register-footer {
  text-align: center;
  margin-top: 20px;
  font-size: 14px;
  color: #999;

  a {
    color: #1989fa;
    margin-left: 4px;
    cursor: pointer;
  }
}
</style>
