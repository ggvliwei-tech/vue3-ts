<!-- script setup 块：使用 Composition API 语法糖定义首页逻辑 -->
<script setup lang="ts">
// 从 vue 中导入 computed 计算属性
import { computed } from 'vue'
// 从 vue-router 中导入 useRouter 函数用于路由导航
import { useRouter } from 'vue-router'
// 导入首页功能入口配置与权限判断工具
import { HOME_ENTRIES, hasAnyPermission } from '@/permission'
import type { HomeEntry } from '@/permission'

// 获取路由导航实例
const router = useRouter()

// 按当前用户权限过滤功能入口：
// 入口配置在 @/permission 中集中声明，权限由 admin 后台的「角色-权限」决定，
// 没有权限的功能直接不渲染，而不是点进去再被后端 403 拦下。
// 用 computed 而非常量，是为了在 syncPermissions 刷新权限后自动重新渲染。
const gridItems = computed<HomeEntry[]>(() =>
  HOME_ENTRIES.filter((entry) => hasAnyPermission(entry.permissions)),
)

// 宫格项点击事件处理函数，接收被点击项数据
function onGridClick(item: HomeEntry) {
  // 导航到对应的路由页面
  router.push(item.route)
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
      <!-- 有可用功能时渲染宫格，设置为 4 列，不显示边框 -->
      <van-grid v-if="gridItems.length" :column-num="4" :border="false">
        <!-- 遍历过滤后的功能入口，渲染每个宫格项 -->
        <van-grid-item
          v-for="item in gridItems"
          :key="item.route"
          :icon="item.icon"
          :text="item.text"
          @click="onGridClick(item)"
        />
      </van-grid>

      <!-- 一个功能都没有权限时的兜底提示，避免首页出现大片空白 -->
      <van-empty v-else description="暂无可用功能，请联系管理员分配权限" />
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
