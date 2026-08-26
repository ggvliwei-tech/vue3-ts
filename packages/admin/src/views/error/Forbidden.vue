<!-- script setup：使用组合式 API -->
<script setup lang="ts">
// 从 vue-router 导入 useRouter 用于返回上一步
import { useRouter } from 'vue-router'
// 从 element-plus 导入 ElButton 组件
import { ElButton } from 'element-plus'

const router = useRouter()

// 返回上一页或 dashboard
function goBack() {
  // 如果有上一页则返回，否则去仪表盘
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/dashboard')
  }
}
</script>

<template>
  <!-- 403 错误页面容器 -->
  <div class="forbidden-page">
    <!-- 大号 403 数字 -->
    <div class="error-code">403</div>
    <!-- 错误标题 -->
    <h2 class="error-title">无权限访问</h2>
    <!-- 错误描述 -->
    <p class="error-desc">您当前的角色或权限不足以访问此页面</p>
    <!-- 操作按钮组 -->
    <div class="actions">
      <el-button type="primary" @click="goBack">返回上一页</el-button>
      <el-button @click="router.push('/dashboard')">回到首页</el-button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
// 整页居中布局
.forbidden-page {
  min-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  background: #fff;
}

// 403 大号灰色数字
.error-code {
  font-size: 120px;
  font-weight: 700;
  color: #dcdfe6;
  line-height: 1;
  margin-bottom: 16px;
}

// 错误标题
.error-title {
  font-size: 24px;
  color: #303133;
  margin: 0 0 12px;
}

// 错误描述
.error-desc {
  font-size: 14px;
  color: #909399;
  margin: 0 0 32px;
}

// 按钮组横向排列
.actions {
  display: flex;
  gap: 12px;
}
</style>
