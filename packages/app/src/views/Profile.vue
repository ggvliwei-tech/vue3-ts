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
  <div class="profile-page">
    <van-nav-bar title="我的" />

    <div class="profile-content">
      <van-cell-group inset>
        <van-cell title="退出登录" is-link @click="handleLogout">
          <template #icon>
            <van-icon name="logout" style="margin-right: 8px; color: #ee0a24" />
          </template>
        </van-cell>
      </van-cell-group>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.profile-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;

  .van-nav-bar {
    flex-shrink: 0;
  }
}

.profile-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px 0;
}
</style>
