<!-- script setup 块：使用 Composition API 语法糖定义首页逻辑 -->
<script setup lang="ts">
// 从 vue-router 中导入 useRouter 函数用于路由导航
import { useRouter } from 'vue-router'
// 从 vant 中导入 showToast 轻提示组件方法
import { showToast } from 'vant'

// 获取路由导航实例
const router = useRouter()

// 定义首页功能宫格数据数组，每个对象包含文字、图标和路由
const gridItems = [
  // 账本功能项，点击跳转到账本列表页面
  { text: '账本', icon: 'balance-o', route: '/account-book' },
  // 文件功能项，点击跳转到文件管理页面
  { text: '文件', icon: 'notes-o', route: '/file-list' },
  // AI 功能项，点击跳转到 AI 聊天页面
  { text: 'AI', icon: 'chat', route: '/ai-chat' },
  // 聊天室功能项，当前暂无路由，点击仅显示提示
  { text: '聊天室', icon: 'comment-o', route: '' },
]

// 宫格项点击事件处理函数，接收被点击项的索引
function onGridClick(index: number) {
  // 根据索引获取对应的宫格项数据
  const item = gridItems[index]
  // 如果该项配置了路由
  if (item.route) {
    // 导航到对应的路由页面
    router.push(item.route)
  // 如果该项没有配置路由
  } else {
    // 弹出轻提示显示功能名称
    showToast(item.text)
  }
}
</script>

<!-- template 模板块：定义首页的 HTML 结构 -->
<template>
  <!-- 首页外层容器 -->
  <div class="home-page">
    <!-- Vant 导航栏组件，标题显示为"首页" -->
    <van-nav-bar title="首页" />

    <!-- 首页内容区域 -->
    <div class="home-content">
      <!-- Vant 宫格组件，设置为 4 列，不显示边框 -->
      <van-grid :column-num="4" :border="false">
        <!-- 遍历宫格数据数组，渲染每个宫格项 -->
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

<!-- style 样式块：定义首页的局部样式 -->
<style lang="scss" scoped>
// 首页页面容器样式
.home-page {
  // 使用 flex 布局
  display: flex;
  // flex 子项垂直排列
  flex-direction: column;
  // 高度占满整个容器
  height: 100%;
  // 隐藏溢出内容
  overflow: hidden;

  // Vant 导航栏样式
  .van-nav-bar {
    // 不允许收缩，保持固定高度
    flex-shrink: 0;
  }
}

// 首页内容区域样式
.home-content {
  // flex 子项占满剩余空间
  flex: 1;
  // 垂直方向可滚动
  overflow-y: auto;
  // 上下内边距 16px
  padding: 16px 0;
}
</style>
