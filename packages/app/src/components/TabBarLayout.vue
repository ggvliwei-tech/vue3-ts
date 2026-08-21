<!-- script setup 块：使用 Composition API 语法糖定义组件逻辑 -->
<script setup lang="ts">
// 从 vue 中导入 ref（响应式引用）和 watch（监听器）函数
import { ref, watch } from 'vue'
// 从 vue-router 中导入 useRoute（获取当前路由信息）和 useRouter（路由导航）函数
import { useRoute, useRouter } from 'vue-router'

// 获取当前路由信息对象
const route = useRoute()
// 获取路由导航实例
const router = useRouter()

// 定义当前激活的 Tab 标签，通过 getActiveTab 函数初始化
const active = ref(getActiveTab())

// 根据当前路由路径确定应该激活哪个 Tab
function getActiveTab(): string {
  // 获取当前路由路径
  const path = route.path
  // 如果路径以 '/home/profile' 开头，则激活 profile 标签
  if (path.startsWith('/home/profile')) return 'profile'
  // 否则默认激活 home 标签
  return 'home'
}

// 监听路由路径变化，当路由变化时自动更新激活的 Tab
watch(
  // 监听函数：返回当前路由路径
  () => route.path,
  // 回调函数：路由变化时重新获取并设置激活的 Tab
  () => {
    active.value = getActiveTab()
  },
)

// Tab 切换时的回调处理函数
function onChange(tab: string) {
  // 如果切换到 home 标签
  if (tab === 'home') {
    // 导航到首页页面
    router.push('/home/index')
  // 如果切换到 profile 标签
  } else if (tab === 'profile') {
    // 导航到个人中心页面
    router.push('/home/profile')
  }
}
</script>

<!-- template 模板块：定义 TabBarLayout 组件的 HTML 结构 -->
<template>
  <!-- 外层容器 div -->
  <div class="tabbar-layout">
    <!-- router-view 路由出口，渲染当前路由对应的页面组件 -->
    <router-view />
    <!-- Vant 底部 TabBar 标签栏组件，v-model 绑定当前激活项，@change 监听切换事件 -->
    <van-tabbar v-model="active" @change="onChange">
      <!-- 首页 Tab 项，name 为 home，图标为 wap-home -->
      <van-tabbar-item name="home" icon="wap-home">首页</van-tabbar-item>
      <!-- 我的 Tab 项，name 为 profile，图标为 contact -->
      <van-tabbar-item name="profile" icon="contact">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<!-- style 样式块：定义组件的局部样式 -->
<style lang="scss" scoped>
// TabBarLayout 布局容器样式
.tabbar-layout {
  // 使用 flex 布局
  display: flex;
  // flex 子项垂直排列
  flex-direction: column;
  // 高度占满整个视口
  height: 100vh;
  // 背景色为浅灰色
  background-color: #f5f5f5;
}
</style>
