<!-- script setup 块：使用 Composition API 语法糖定义个人中心页面逻辑 -->
<script setup lang="ts">
// 从 vue 中导入 computed 计算属性
import { computed } from 'vue'
// 从 vue-router 中导入 useRouter 函数用于路由导航
import { useRouter } from 'vue-router'
// 从 vant 中导入 showDialog 对话框和 showToast 轻提示组件方法
import { showDialog, showToast } from 'vant'
// 导入全局认证 store，作为用户信息与权限的唯一来源
import { useAuthStore } from '@project/shared/stores/useAuthStore'
// 统一登出清理（同时通知其他标签页）
import { notifyLogout } from '@project/shared/token-refresh'
// 调用后端登出接口，吊销 refresh token
import { logout } from '@/api/user'

// 获取路由导航实例
const router = useRouter()
// 获取认证 store
const authStore = useAuthStore()

// 用户名：直接读 store，避免与 localStorage 里的副本不一致
const username = computed(() => authStore.userInfo?.username ?? '')
// 当前账号的角色列表，展示给用户便于自查为什么某些功能不可见
const roles = computed(() => authStore.roles)

// 处理退出登录的函数
function handleLogout() {
  // 弹出确认对话框，标题为"确认退出"，内容为"确定要退出登录吗？"，显示取消按钮
  showDialog({
    title: '确认退出',
    message: '确定要退出登录吗？',
    showCancelButton: true,
  })
    // 用户点击确认按钮后的处理逻辑
    .then(async () => {
      // 通知服务端吊销 refresh token、销毁该设备会话
      // （此前 app 端登出只清本地，服务端 RT 仍然有效 —— 会话残留问题）
      try {
        await logout()
      } catch {
        // 服务端登出失败不应阻止本地登出
      }
      // 统一清理本地认证状态并通知其他标签页一并登出。
      // 必须清干净：否则退出后刷新页面，残留的旧 token 和权限
      // 会让应用误判为已登录，并用上一个账号的权限渲染功能入口
      notifyLogout()
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
      <!-- 用户信息卡片 -->
      <div class="user-info-card">
        <!-- 用户头像 -->
        <van-icon name="user-circle-o" size="56" color="#1989fa" class="user-avatar" />
        <!-- 用户名 -->
        <div class="user-name">{{ username || '未登录' }}</div>
        <!-- 角色标签：让用户知道自己当前是什么角色，可见功能由此决定 -->
        <div v-if="roles.length" class="user-roles">
          <van-tag v-for="role in roles" :key="role" type="primary" plain>{{ role }}</van-tag>
        </div>
      </div>

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

// 用户信息卡片样式
.user-info-card {
  // 使用 flex 布局
  display: flex;
  // 子项垂直居中
  flex-direction: column;
  // 水平居中对齐
  align-items: center;
  // 底部外边距 20px
  margin-bottom: 20px;
  // 顶部内边距 24px
  padding-top: 24px;

  // 用户头像样式
  .user-avatar {
    // 底部外边距 12px
    margin-bottom: 12px;
  }

  // 用户名样式
  .user-name {
    // 字体大小 18px
    font-size: 18px;
    // 字体颜色深灰
    color: #323233;
    // 字体粗细 500
    font-weight: 500;
  }

  // 角色标签容器样式
  .user-roles {
    // 顶部外边距 8px
    margin-top: 8px;
    // 使用 flex 布局横向排列标签
    display: flex;
    // 标签之间的间距 6px
    gap: 6px;
    // 标签过多时换行
    flex-wrap: wrap;
    // 水平居中
    justify-content: center;
  }
}
</style>
