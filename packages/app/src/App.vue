<!--
  App 前台应用根组件
  使用 Vue 3 Composition API 的 <script setup> 语法
-->
<script setup lang="ts">
import { ref } from 'vue'

const value = ref('')
</script>

<!-- 组件模板区域 -->
<template>
  <!-- 页面容器：显示 app 前台应用标识 -->
  <div> 我是app</div>
  <van-button type="primary">主要按钮</van-button>
  <van-cell-group inset>
    <van-field v-model="value" label="文本" placeholder="请输入用户名" />
  </van-cell-group>
  <div class="a">当前用户名：{{ value }}
    <div class="b">wkss </div>
  </div>
</template>

<!-- 样式区域（待扩展） -->

<style lang="scss" scoped>
  .a{
    .b{
      color: red;
    }
  }
</style>
