<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const active = ref(getActiveTab())

function getActiveTab(): string {
  const path = route.path
  if (path.startsWith('/home/profile')) return 'profile'
  return 'home'
}

watch(
  () => route.path,
  () => {
    active.value = getActiveTab()
  },
)

function onChange(tab: string) {
  if (tab === 'home') {
    router.push('/home/index')
  } else if (tab === 'profile') {
    router.push('/home/profile')
  }
}
</script>

<template>
  <div class="tabbar-layout">
    <router-view />
    <van-tabbar v-model="active" @change="onChange">
      <van-tabbar-item name="home" icon="wap-home">首页</van-tabbar-item>
      <van-tabbar-item name="profile" icon="contact">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<style lang="scss" scoped>
.tabbar-layout {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding-bottom: 50px;
}
</style>
