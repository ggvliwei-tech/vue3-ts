<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { showToast } from 'vant'
import { login } from '@/api/user'

const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const loading = ref(false)

async function handleLogin() {
  if (!username.value.trim()) {
    showToast('请输入用户名')
    return
  }
  if (!password.value) {
    showToast('请输入密码')
    return
  }

  loading.value = true
  try {
    const res = await login({
      username: username.value.trim(),
      password: password.value,
    })
    localStorage.setItem('token', res.data.data.accessToken)
    showToast('登录成功')
    router.push((route.query.redirect as string) || '/home')
  } catch (e: any) {
    showToast(e.message || '登录失败')
  } finally {
    loading.value = false
  }
}

function goRegister() {
  router.push('/register')
}
</script>

<template>
  <div class="login-page">
    <div class="login-header">
      <h2>用户登录</h2>
    </div>

    <van-form @submit="handleLogin">
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
      </van-cell-group>

      <div class="login-btn-wrap">
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

    <div class="login-footer">
      <span>还没有账号？</span>
      <a @click="goRegister">去注册</a>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.login-page {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding-top: 80px;
}

.login-header {
  text-align: center;
  margin-bottom: 30px;

  h2 {
    font-size: 28px;
    color: #333;
  }
}

.login-btn-wrap {
  padding: 20px 16px;
}

.login-footer {
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
