<!-- script setup 块：使用 Composition API 语法糖定义个人中心页面逻辑 -->
<script setup lang="ts">
// 从 vue-router 中导入 useRouter 函数用于路由导航
import { useRouter } from 'vue-router'
// 从 vant 中导入 showDialog 对话框和 showToast 轻提示组件方法
import { showDialog, showToast } from 'vant'

// 获取路由导航实例
const router = useRouter()

// 处理退出登录的函数
function handleLogout() {
  // 弹出确认对话框，标题为"确认退出"，内容为"确定要退出登录吗？"，显示取消按钮
  showDialog({
    title: '确认退出',
    message: '确定要退出登录吗？',
    showCancelButton: true,
  })
    // 用户点击确认按钮后的处理逻辑
    .then(() => {
      // 从 localStorage 中清除 token，使用户变为未登录状态
      localStorage.removeItem('token')
      // 弹出已退出登录的轻提示
      showToast('已退出登录')
      // 导航到登录页面
      router.push('/login')
    })
    // 用户点击取消按钮后的处理逻辑
    .catch(() => {
      // 取消退出，不执行任何操作
    })
}
</script>

<!-- template 模板块：定义个人中心页面的 HTML 结构 -->
<template>
  <!-- 个人中心页面外层容器 -->
  <div class="profile-page">
    <!-- Vant 导航栏组件，标题显示为"我的" -->
    <van-nav-bar title="我的" />

    <!-- 个人中心内容区域 -->
    <div class="profile-content">
      <!-- Vant 单元格组，inset 属性使卡片内缩显示 -->
      <van-cell-group inset>
        <!-- 退出登录单元格，is-link 显示右侧箭头，点击触发退出登录函数 -->
        <van-cell title="退出登录" is-link @click="handleLogout">
          <!-- 使用自定义 icon 插槽插入退出图标 -->
          <template #icon>
            <!-- 退出图标，设置右侧间距和红色 -->
            <van-icon name="logout" style="margin-right: 8px; color: #ee0a24" />
          </template>
        </van-cell>
      </van-cell-group>
    </div>
  </div>
</template>

<!-- style 样式块：定义个人中心页面的局部样式 -->
<style lang="scss" scoped>
// 个人中心页面容器样式
.profile-page {
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

// 个人中心内容区域样式
.profile-content {
  // flex 子项占满剩余空间
  flex: 1;
  // 垂直方向可滚动
  overflow-y: auto;
  // 上下内边距 20px
  padding: 20px 0;
}
</style>
