<script setup lang="ts">
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'

const router = useRouter()

function handleLogout() {
  showConfirmDialog({
    title: '确认退出',
    message: '确定要退出登录吗？',
  })
    .then(() => {
      localStorage.removeItem('token')
      showToast('已退出登录')
      router.push('/login')
    })
    .catch(() => {
      // 取消退出
    })
}
</script>

<template>
  <div class="home-page">
    <van-nav-bar title="首页" />

    <div class="home-content">
      <van-cell-group inset>
        <van-cell title="欢迎使用" label="登录成功，欢迎回来" />
      </van-cell-group>

      <div class="logout-wrap">
        <van-button type="danger" block round @click="handleLogout">
          退出登录
        </van-button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.home-page {
  min-height: 100vh;
  background-color: #f5f5f5;
}

.home-content {
  padding: 20px 0;
}

.logout-wrap {
  padding: 30px 16px;
}
</style>
