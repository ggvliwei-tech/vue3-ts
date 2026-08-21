<!-- script setup 部分：使用组合式 API 和语法糖，当前无逻辑代码 -->
<script setup lang="ts">
</script>

<!-- 模板部分：定义仪表盘页面的 HTML 结构 -->
<template>
  <!-- 仪表盘页面外层容器 -->
  <div class="dashboard">
    <!-- Element Plus 栅格布局行组件，设置列间距为 20px -->
    <el-row :gutter="20">
      <!-- 栅格列，占据 8 列宽度（共 24 列，即占 1/3 宽度） -->
      <el-col :span="8">
        <!-- Element Plus 卡片组件，hover 时显示阴影效果 -->
        <el-card shadow="hover">
          <!-- 使用具名插槽设置卡片标题 -->
          <template #header>欢迎</template>
          <!-- 卡片正文内容 -->
          <p>管理后台运行正常</p>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<!-- 样式部分：使用 SCSS 预处理，scoped 表示样式仅作用于当前组件 -->
<style lang="scss" scoped>
// 仪表盘容器样式，设置 20px 内边距
.dashboard {
  padding: 20px;
}
</style>
