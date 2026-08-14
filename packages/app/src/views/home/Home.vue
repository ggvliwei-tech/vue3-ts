<script setup lang="ts">
import { useRouter } from 'vue-router'
import { showToast } from 'vant'

const router = useRouter()

const gridItems = [
  { text: '账本', icon: 'balance-o', route: '/account-book' },
  { text: '文件', icon: 'notes-o', route: '/file-list' },
  { text: 'AI', icon: 'chat', route: '/ai-chat' },
  { text: '聊天室', icon: 'comment-o', route: '' },
]

function onGridClick(index: number) {
  const item = gridItems[index]
  if (item.route) {
    router.push(item.route)
  } else {
    showToast(item.text)
  }
}
</script>

<template>
  <div class="home-page">
    <van-nav-bar title="首页" />

    <div class="home-content">
      <van-grid :column-num="4" :border="false">
        <van-grid-item
          v-for="(item, index) in gridItems"
          :key="index"
          :icon="item.icon"
          :text="item.text"
          @click="onGridClick(index)"
        />
      </van-grid>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.home-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;

  .van-nav-bar {
    flex-shrink: 0;
  }
}

.home-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0;
}
</style>
