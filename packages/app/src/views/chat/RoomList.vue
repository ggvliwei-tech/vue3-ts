<!-- script setup 块：使用 Composition API 语法糖定义房间列表页逻辑 -->
<script setup lang="ts">
// 从 vue 中导入 ref（响应式引用）、computed（计算属性）和 onMounted（生命周期钩子）
import { ref, computed, onMounted } from 'vue'
// 从 vue-router 中导入 useRouter 函数用于路由导航
import { useRouter } from 'vue-router'
// 从 vant 中导入 showToast 轻提示组件方法
import { showToast } from 'vant'
// 从聊天室 API 模块中导入房间列表、我的房间、加入房间、创建房间的函数
import { getRoomList, getMyRooms, joinRoomApi, createRoom, type ChatRoom } from '@/api/chat'

// 获取路由导航实例
const router = useRouter()

// 当前页签：0 = 我的房间，1 = 发现房间
const activeTab = ref(0)
// 我加入的房间（私有房间语义：只有成员才能进入）
const myRooms = ref<ChatRoom[]>([])
// 全部房间（发现页签，用于找到并加入新房间）
const discoverRooms = ref<ChatRoom[]>([])
// 全部房间总数
const total = ref(0)
// 列表加载状态
const loading = ref(false)
// 正在加入的房间 ID（0 表示空闲），用于连点保护与按钮 loading
const joiningId = ref(0)
// 是否显示创建房间弹窗
const showCreateDialog = ref(false)
// 新房间名称
const newRoomName = ref('')

// 我加入的房间 ID 集合，用于在「发现房间」里标记「已加入」
const myRoomIds = computed(() => new Set(myRooms.value.map((r) => r.id)))
// 当前页签展示的房间列表
const currentRooms = computed(() => (activeTab.value === 0 ? myRooms.value : discoverRooms.value))
// 当前页签的空状态文案
const emptyDescription = computed(() =>
  activeTab.value === 0 ? '还没有加入任何房间' : '暂无可加入的房间',
)

// 组件挂载时加载列表
//
// 这里用 onMounted 而非 onActivated 就够：App.vue 的 <router-view> 没有包 keep-alive，
// 组件在离开路由时会被卸载、返回时重新挂载，因此从 ChatRoom 返回后必然重新拉取，
// 刚加入的房间会立刻出现。若将来给 router-view 加上了 keep-alive，这里需要改成 onActivated。
onMounted(() => {
  loadAll()
})

// 并发加载两个列表
async function loadAll() {
  loading.value = true
  try {
    // 两个接口互不依赖；各自内部已 catch 并提示，不会因为一个失败而丢掉另一个的数据
    await Promise.all([loadMyRooms(), loadDiscoverRooms()])
  } finally {
    loading.value = false
  }
}

// 加载「我的房间」
async function loadMyRooms() {
  try {
    const res = await getMyRooms()
    // res.data 即为 TransformInterceptor 解包后的 data（这里是 ChatRoom[]）
    myRooms.value = res.data
  } catch (err: any) {
    showToast(err.message || '加载我的房间失败')
  }
}

// 加载「发现房间」
async function loadDiscoverRooms() {
  try {
    const res = await getRoomList()
    discoverRooms.value = res.data.list
    total.value = res.data.total
  } catch (err: any) {
    showToast(err.message || '加载房间列表失败')
  }
}

/**
 * 点击房间项：进入聊天室（未加入时先加入）
 *
 * 加入动作放在这里而不是 ChatRoom.vue 里，是为了让用户点下去就有反馈；
 * ChatRoom.vue 进入时**仍会**再调一次 joinRoomApi —— 那是深链直达时的兜底，
 * 也是「进入房间即可读历史」这个不变量的保证点。两者都靠 join 的幂等性支撑。
 */
async function onRoomClick(room: ChatRoom) {
  // 已是成员：直接进入，不必再请求
  if (myRoomIds.value.has(room.id)) {
    router.push(`/chat/${room.id}`)
    return
  }
  // 连点保护：同一时刻只允许一个加入请求在飞
  if (joiningId.value) return
  joiningId.value = room.id
  try {
    // POST /chat/join 幂等（服务端 INSERT IGNORE + 已存在则直接返回），重复调用无副作用
    await joinRoomApi({ roomId: room.id })
    // 并入「我的房间」列表（服务端按 joinedAt DESC 排序，新加入的排最前），
    // 这样用户返回本页时即使接口失败也仍能看到刚加入的房间
    myRooms.value = [room, ...myRooms.value]
    router.push(`/chat/${room.id}`)
  } catch (err: any) {
    showToast(err.message || '加入房间失败')
  } finally {
    joiningId.value = 0
  }
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
    // 调用 API 创建房间（服务端在同一事务里把创建者写入 chat_member）
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

// 返回上一页
//
// 不能无条件用 router.back()：/rooms 被直接打开（外链、刷新后恢复）时浏览器历史里
// 没有本站的上一条记录，back() 会把用户弹出应用。没有可回退记录时落到首页。
function goBack() {
  if (window.history.state?.back) router.back()
  else router.replace('/home')
}

// 从共享模块中导入日期格式化工具
import { formatDate } from '@project/shared'
</script>

<!-- template 模板块：定义房间列表页的 HTML 结构 -->
<template>
  <!-- 房间列表页外层容器 -->
  <div class="room-list-page">
    <!-- Vant 导航栏组件，标题显示为"聊天室"，右侧有添加图标 -->
    <van-nav-bar title="聊天室" left-arrow @click-left="goBack">
      <!-- 右侧插槽：放置添加房间图标按钮；无 chat:room-create 权限时不渲染 -->
      <template #right>
        <van-icon v-permission="'chat:room-create'" name="add-o" size="22" @click="showCreateRoomDialog" />
      </template>
    </van-nav-bar>

    <!-- 两个页签：我的房间（成员制私有房间）/ 发现房间（可加入的全部房间） -->
    <van-tabs v-model:active="activeTab" class="room-tabs">
      <van-tab title="我的房间" />
      <van-tab :title="total > 0 ? `发现房间 (${total})` : '发现房间'" />
    </van-tabs>

    <!-- 房间列表区域 -->
    <div class="room-list-container">
      <!-- 加载中状态 -->
      <van-loading v-if="loading" size="24px" vertical class="loading-hint">
        加载中...
      </van-loading>

      <!-- 空状态提示 -->
      <van-empty v-else-if="currentRooms.length === 0" image="search" :description="emptyDescription">
        <!-- 空状态下的创建按钮；无 chat:room-create 权限时不渲染 -->
        <van-button v-permission="'chat:room-create'" type="primary" size="small" round @click="showCreateRoomDialog">
          创建房间
        </van-button>
        <!-- 我的房间为空时，引导到发现页签去加入 -->
        <van-button v-if="activeTab === 0" size="small" round plain class="goto-discover" @click="activeTab = 1">
          去发现房间
        </van-button>
      </van-empty>

      <!-- 房间列表 -->
      <div v-else class="room-list">
        <!-- 遍历当前页签的房间列表，渲染每个房间项 -->
        <div
          v-for="room in currentRooms"
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
          <!-- 右侧操作区：发现页签下区分「已加入」与「加入」，我的房间直接显示箭头 -->
          <template v-if="activeTab === 1">
            <van-tag v-if="myRoomIds.has(room.id)" plain class="joined-tag">已加入</van-tag>
            <van-button
              v-else
              size="mini"
              type="primary"
              round
              :loading="joiningId === room.id"
              class="join-btn"
            >
              加入
            </van-button>
          </template>
          <van-icon v-else name="arrow" size="16" color="#c8c9cc" class="room-arrow" />
        </div>
      </div>

      <!-- 底部房间总数提示（仅发现页签有意义） -->
      <div v-if="activeTab === 1 && discoverRooms.length > 0" class="room-footer">
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

// 页签栏样式
//
// 这里把 van-tabs 当「分段控制器」用：两个 van-tab 都不带内容，
// 列表统一由下方 .room-list-container 按 activeTab 渲染，避免两套几乎相同的模板。
.room-tabs {
  // 不允许收缩
  flex-shrink: 0;
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

  // 「已加入」标签样式
  .joined-tag {
    // 不允许收缩
    flex-shrink: 0;
    // 字体颜色浅灰
    color: #969799;
  }

  // 「加入」按钮样式
  .join-btn {
    // 不允许收缩
    flex-shrink: 0;
    // 左右内边距
    padding: 0 14px;
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

// 空状态下「去发现房间」按钮
.goto-discover {
  // 左侧间距
  margin-left: 8px;
}

// 创建弹窗输入框样式
.room-name-input {
  // 内边距 16px
  padding: 16px;
}
</style>
