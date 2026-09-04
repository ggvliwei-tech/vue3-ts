<!-- script setup 块：无权限提示页逻辑 -->
<script setup lang="ts">
// 从 vue-router 导入路由实例与当前路由信息
import { useRoute, useRouter } from 'vue-router'

// 获取路由导航实例
const router = useRouter()
// 获取当前路由信息，用于读取 from 参数
const route = useRoute()

// 被拦截的来源路径，用于提示用户是哪个功能没有权限
const from = (route.query.from as string) ?? ''

// 返回首页
function goHome() {
  router.replace('/home/index')
}
</script>

<!-- template 模板块：403 页面结构 -->
<template>
  <div class="forbidden-page">
    <!-- 顶部导航栏 -->
    <van-nav-bar title="无访问权限" />

    <!-- 空状态提示区域 -->
    <div class="forbidden-content">
      <van-empty image="error" description="你没有该功能的访问权限">
        <!-- 显示被拦截的路径，方便用户向管理员描述问题 -->
        <p v-if="from" class="forbidden-from">请求路径：{{ from }}</p>
        <p class="forbidden-tip">如需使用，请联系管理员为你的账号分配对应角色</p>
        <van-button round type="primary" class="forbidden-btn" @click="goHome">
          返回首页
        </van-button>
      </van-empty>
    </div>
  </div>
</template>

<!-- style 样式块：403 页面局部样式 -->
<style lang="scss" scoped>
// 页面容器
.forbidden-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;

  .van-nav-bar {
    flex-shrink: 0;
  }
}

// 内容区域
.forbidden-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
}

// 被拦截路径文案
.forbidden-from {
  margin: 0 0 4px;
  font-size: 12px;
  color: #969799;
  word-break: break-all;
}

// 提示文案
.forbidden-tip {
  margin: 0 0 16px;
  font-size: 12px;
  color: #969799;
}

// 返回按钮
.forbidden-btn {
  width: 160px;
}
</style>
