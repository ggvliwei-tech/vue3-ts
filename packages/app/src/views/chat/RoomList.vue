<!-- script setup 块：使用 Composition API 语法糖定义房间列表页逻辑 -->
<script setup lang="ts">
// 从 vue 中导入 ref（响应式引用）和 onMounted（生命周期钩子）
import { ref, onMounted } from 'vue'
// 从 vue-router 中导入 useRouter 函数用于路由导航
import { useRouter } from 'vue-router'
// 从 vant 中导入 showToast 轻提示组件方法
import { showToast } from 'vant'
// 从聊天室 API 模块中导入获取房间列表和创建房间的函数
import { getRoomList, createRoom, type ChatRoom } from '@/api/chat'

// 获取路由导航实例
const router = useRouter()

// 定义房间列表的响应式数组
const roomList = ref<ChatRoom[]>([])
// 定义加载状态的响应式数据
const loading = ref(false)
// 定义是否显示创建房间弹窗的响应式数据
const showCreateDialog = ref(false)
// 定义新房间名称的响应式数据
const newRoomName = ref('')
// 定义总房间数的响应式数据
const total = ref(0)

// 组件挂载时加载房间列表
onMounted(() => {
  loadRoomList()
})

// 加载房间列表的异步函数
async function loadRoomList() {
  // 设置加载状态为 true
  loading.value = true
  try {
    // 调用 API 获取房间列表
    const res = await getRoomList()
    // 从响应中提取房间列表数据（res.data 即为 TransformInterceptor 返回的 data）
    roomList.value = res.data.list
    // 更新总房间数
    total.value = res.data.total
  } catch (err: any) {
    // 加载失败时显示错误提示
    showToast(err.message || '加载失败')
  } finally {
    // 无论成功还是失败，都将加载状态重置为 false
    loading.value = false
  }
}

// 点击房间项进入聊天室的函数
function onRoomClick(room: ChatRoom) {
  // 导航到聊天室页面，携带房间 ID
  router.push(`/chat/${room.id}`)
}

// 显示创建房间弹窗的函数
function showCreateRoomDialog() {
  // 清空输入框
  newRoomName.value = ''
  // 显示弹窗
  showCreateDialog.value = true
}

// 确认创建房间的异步函数
async function onConfirmCreate() {
  // 获取输入的房间名称并去除首尾空格
  const name = newRoomName.value.trim()
  // 如果名称为空则显示提示并返回
  if (!name) {
    showToast('请输入房间名称')
    return
  }
  try {
    // 调用 API 创建房间
    const res = await createRoom({ name })
    // 关闭弹窗
    showCreateDialog.value = false
    // 显示成功提示
    showToast('创建成功')
    // 直接导航到新创建的聊天室
    router.push(`/chat/${res.data.id}`)
  } catch (err: any) {
    // 创建失败时显示错误提示
    showToast(err.message || '创建失败')
  }
}

// 从共享模块中导入日期格式化工具
import { formatDate } from '@project/shared'
</script>

<!-- template 模板块：定义房间列表页的 HTML 结构 -->
<template>
  <!-- 房间列表页外层容器 -->
  <div class="room-list-page">
    <!-- Vant 导航栏组件，标题显示为"聊天室"，右侧有添加图标 -->
    <van-nav-bar title="聊天室" left-arrow @click-left="router.back()">
      <!-- 右侧插槽：放置添加房间图标按钮 -->
      <template #right>
        <van-icon name="add-o" size="22" @click="showCreateRoomDialog" />
      </template>
    </van-nav-bar>

    <!-- 房间列表区域 -->
    <div class="room-list-container">
      <!-- 加载中状态 -->
      <van-loading v-if="loading" size="24px" vertical class="loading-hint">
        加载中...
      </van-loading>

      <!-- 空状态提示 -->
      <van-empty
        v-else-if="roomList.length === 0"
        image="search"
        description="暂无聊天房间"
      >
        <!-- 空状态下的创建按钮 -->
        <van-button type="primary" size="small" round @click="showCreateRoomDialog">
          创建第一个房间
        </van-button>
      </van-empty>

      <!-- 房间列表 -->
      <div v-else class="room-list">
        <!-- 遍历房间列表，渲染每个房间项 -->
        <div
          v-for="room in roomList"
          :key="room.id"
          class="room-item"
          @click="onRoomClick(room)"
        >
          <!-- 房间图标 -->
          <van-icon name="chat-o" size="32" color="#1989fa" class="room-icon" />
          <!-- 房间信息 -->
          <div class="room-info">
            <!-- 房间名称 -->
            <div class="room-name">{{ room.name }}</div>
            <!-- 创建时间 -->
            <div class="room-time">创建于 {{ formatDate(room.createdAt) }}</div>
          </div>
          <!-- 进入箭头 -->
          <van-icon name="arrow" size="16" color="#c8c9cc" class="room-arrow" />
        </div>
      </div>

      <!-- 底部房间总数提示 -->
      <div v-if="roomList.length > 0" class="room-footer">
        共 {{ total }} 个房间
      </div>
    </div>

    <!-- 创建房间弹窗 -->
    <van-dialog
      v-model:show="showCreateDialog"
      title="创建房间"
      show-cancel-button
      :before-close="() => true"
      @confirm="onConfirmCreate"
    >
      <!-- 弹窗内容：房间名称输入框 -->
      <van-field
        v-model="newRoomName"
        placeholder="请输入房间名称"
        maxlength="50"
        :autosize="false"
        class="room-name-input"
      />
    </van-dialog>
  </div>
</template>

<!-- style 样式块：定义房间列表页的局部样式 -->
<style lang="scss" scoped>
// 房间列表页容器样式
.room-list-page {
  // 使用 flex 布局
  display: flex;
  // 垂直排列
  flex-direction: column;
  // 高度占满整个视口
  height: 100vh;
  // 背景色为浅灰色
  background: #f5f5f5;
}

// 房间列表区域容器
.room-list-container {
  // flex 子项占满剩余空间
  flex: 1;
  // 垂直方向可滚动
  overflow-y: auto;
  // 内边距左右 12px 上下 16px
  padding: 16px 12px;
}

// 加载中提示样式
.loading-hint {
  // 居中显示
  margin: 60px auto;
}

// 房间列表容器
.room-list {
  // 使用 flex 布局
  display: flex;
  // 垂直排列
  flex-direction: column;
  // 子元素间距 12px
  gap: 12px;
}

// 单个房间项样式
.room-item {
  // 使用 flex 布局
  display: flex;
  // 子项垂直居中
  align-items: center;
  // 背景色白色
  background: #fff;
  // 圆角 12px
  border-radius: 12px;
  // 左右内边距 16px 上下 14px
  padding: 14px 16px;
  // 子元素间距 14px
  gap: 14px;
  // 添加轻微阴影
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  // 按下时背景变深
  &:active {
    background: #f2f3f5;
  }

  // 房间图标样式
  .room-icon {
    // 不允许收缩
    flex-shrink: 0;
  }

  // 房间信息容器
  .room-info {
    // flex 子项占满剩余空间
    flex: 1;
    // 最小宽度为 0 允许文字截断
    min-width: 0;
  }

  // 房间名称样式
  .room-name {
    // 字体大小 16px
    font-size: 16px;
    // 字体颜色深灰
    color: #323233;
    // 字体粗细 500
    font-weight: 500;
    // 文字溢出时显示省略号
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  // 创建时间样式
  .room-time {
    // 字体大小 12px
    font-size: 12px;
    // 字体颜色浅灰
    color: #969799;
    // 顶部间距 4px
    margin-top: 4px;
  }

  // 右侧箭头样式
  .room-arrow {
    // 不允许收缩
    flex-shrink: 0;
  }
}

// 底部房间总数提示
.room-footer {
  // 顶部外边距 16px
  margin-top: 16px;
  // 文字居中
  text-align: center;
  // 字体大小 12px
  font-size: 12px;
  // 字体颜色浅灰
  color: #969799;
}

// 创建弹窗输入框样式
.room-name-input {
  // 内边距 16px
  padding: 16px;
}
</style>
