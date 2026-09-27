<!-- script setup 块：使用 Composition API 语法糖定义聊天室页面逻辑 -->
<script setup lang="ts">
// 从 vue 中导入 ref（响应式引用）、onMounted/onUnmounted（生命周期钩子）、nextTick（DOM 更新后回调）
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
// 从 vue-router 中导入 useRouter 和 useRoute 函数用于路由导航和参数获取
import { useRouter, useRoute } from 'vue-router'
// 从 vant 中导入 showToast 轻提示组件方法
import { showToast } from 'vant'
// 从聊天室 API 模块中导入获取历史消息、加入房间的函数
import { getRoomMessages, joinRoomApi, type ChatMessage, type ChatMember } from '@/api/chat'
// 从 WebSocket 工具模块中导入连接、断开、发送、加入、离开房间的函数
import {
  connectWebSocket, clearWebSocketHandlers,
  sendRoomMessage, joinRoom, leaveRoom,
  type WSMessage, type WSEventHandlers,
} from '@/utils/websocket'
// 认证状态统一从 auth-storage 读取
import { getToken, parseJwt } from '@project/shared/auth-storage'

// 获取路由导航实例
const router = useRouter()
// 获取当前路由实例用于读取路由参数
const route = useRoute()

// 定义聊天消息的接口（前端展示用，包含 isSelf 标记）
interface UIMessage extends ChatMessage {
  isSelf?: boolean   // 是否为当前用户自己发送的消息
  isTemp?: boolean   // 是否为乐观更新的临时消息（等待 server 确认）
}

// 定义消息列表的响应式数组
const messages = ref<UIMessage[]>([])
// 定义输入框文本的响应式数据
const inputText = ref('')
// 定义是否 WebSocket 已连接的响应式数据
const isWsConnected = ref(false)
// 定义房间成员列表的响应式数组
const members = ref<ChatMember[]>([])
// 定义当前用户 ID 的响应式数据（从 JWT 解码获取）
const myUserId = ref<number>(0)
// 定义房间 ID 的响应式数据
const roomId = ref<number>(0)
// 定义房间名称的响应式数据
const roomName = ref('聊天室')
// 定义是否显示成员面板的响应式数据
const showMemberPanel = ref(false)
// 定义在线用户 ID 集合的响应式数据（用于显示在线状态）
const onlineUserIds = ref<Set<number>>(new Set())
// 定义当前加载消息页码的响应式数据
const currentPage = ref(1)
// 定义是否还有更多历史消息的响应式数据
const hasMoreHistory = ref(true)
// 定义是否正在加载历史消息的响应式数据
const loadingHistory = ref(false)

// 定义聊天容器的 DOM 引用
const chatContainerRef = ref<HTMLDivElement | null>(null)

// 是否已建立 WS 通道并声明加入房间（未建立时无需再向服务端声明离开）
let wsBound = false
// 清理是否已执行过（teardown 的幂等开关）
let tornDown = false

// 组件挂载时初始化聊天室
onMounted(async () => {
  // 从路由参数中获取房间 ID
  const id = Number(route.params.roomId)
  // 如果房间 ID 无效则返回上一页
  if (!id) {
    showToast('无效的房间')
    goBack()
    return
  }
  // 设置当前房间 ID
  roomId.value = id

  // 从统一存储层读取 token 并解析出当前用户 ID
  // 改用共享的 parseJwt：此前这里自行 atob 解码，没有做 base64url 的 -/_ 还原，
  // 遇到 payload 中含 - 或 _ 的 token 会解析失败并把用户直接踢回登录页
  const payload = parseJwt(getToken())
  if (!payload?.sub) {
    // 未登录 / token 无法解析：回登录页
    router.push('/login')
    return
  }
  myUserId.value = payload.sub

  // ① 先用 REST 幂等地加入房间，确保 chat_member 里有成员关系
  //
  // 这一步**必须在读历史之前**。GET /chat/messages 会走 assertUserInRoom，
  // 而成员关系的权威来源就是 chat_member 那一行 —— 之前把这个动作放在
  // WS 的 join-room 里、且排在 loadHistory 之后，于是每次进入房间都先吃一个
  // 403「您不在该房间中」，再由 WS 把界面救回来。
  // joinRoomApi 是幂等的（服务端 INSERT IGNORE + 已存在直接返回），重复进入无副作用。
  try {
    await joinRoomApi({ roomId: roomId.value })
  } catch (err: any) {
    showToast(err.message || '加入房间失败')
    teardown()
    goBack()
    return
  }
  // 等待期间组件可能已被卸载（用户快速返回），后续动作全部放弃
  if (tornDown) return

  // ② 成员关系已就绪，此时必然 200
  await loadHistory()
  if (tornDown) return

  // ③ 最后建立实时通道
  setupWebSocket()
})

// 加载历史消息的异步函数
async function loadHistory() {
  // 设置加载历史状态为 true
  loadingHistory.value = true
  try {
    // 调用 API 获取指定房间的历史消息
    const res = await getRoomMessages(roomId.value, currentPage.value, 50)
    // 将获取到的消息列表添加到消息数组前面（新消息在底部）
    messages.value = [...res.data.list.map(m => ({ ...m, isSelf: m.senderId === myUserId.value })), ...messages.value]
    // 如果返回的消息数少于 50 条，说明没有更多历史了
    hasMoreHistory.value = res.data.list.length >= 50
  } catch (err: any) {
    // 加载失败时显示错误提示
    showToast(err.message || '加载历史消息失败')
  } finally {
    // 重置加载历史状态
    loadingHistory.value = false
  }
}

// 加载更多历史消息的异步函数（滚动到顶部时触发）
async function loadMore() {
  // 如果正在加载或没有更多历史，则直接返回
  if (loadingHistory.value || !hasMoreHistory.value) return

  const container = chatContainerRef.value
  // 加载前先量下视口锚点。loadHistory 是往数组**头部**插入（见上面那行
  // `[...新消息, ...messages.value]`），所以新增内容会把整段内容往下推；
  // 不补这个高度差，用户当前看的那条消息就会跳出视口。
  const prevScrollHeight = container?.scrollHeight ?? 0
  const prevScrollTop = container?.scrollTop ?? 0

  // 页码加 1
  currentPage.value++
  // 加载下一页历史消息
  await loadHistory()
  // 等待 DOM 更新
  await nextTick()

  if (container) {
    // 新增高度 = 新 scrollHeight - 旧 scrollHeight，把它加到原来的 scrollTop 上，
    // 用户看到的那条消息就停在原地。
    //
    // 此前这里写的是 `container.scrollTop = container.scrollHeight -
    // (container.scrollHeight - container.scrollTop)` —— 右式化简后恒等于
    // `container.scrollTop`，是一次自赋值，等于什么都没做：注释承诺的
    // 「保持视口位置不变」从未生效，上拉加载时内容会跳一次。
    container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight)
  }
}

// 设置 WebSocket 连接的函数
function setupWebSocket() {
  // 定义事件回调对象
  const handlers: WSEventHandlers = {
    // 连接成功回调
    onConnect: () => {
      // 更新连接状态
      isWsConnected.value = true
      // 发送加入房间事件
      joinRoom(roomId.value)
    },
    // 断开连接回调
    onDisconnect: (reason) => {
      // 更新连接状态
      isWsConnected.value = false
      // 输出断开原因日志
      console.log('[WS] 断开连接:', reason)
    },
    // 错误回调
    onError: (error) => {
      // 显示错误提示
      showToast(error.msg)
    },
    // 加入房间成功回调
    onRoomJoined: (data) => {
      // socket 是单例，离开房间后仍可能收到上一个房间的尾包，必须按 roomId 丢弃
      if (data.roomId !== roomId.value) return

      // 成员名册是**持久成员关系**，整体覆盖
      members.value = data.members
      // 注意：这里**不**写 onlineUserIds（旧实现把 members 全标为在线，离线成员会显示绿点）。
      // 「谁在线」的唯一写入方是下面的 onPresence —— 服务端在 room-joined 之前
      // 就已经广播过 presence，所以这里不写也不会短暂显示 0 人。

      // 合并 WS 返回的历史消息（去重）
      const wsHistory = data.history || []
      const existingIds = new Set(messages.value.map(m => m.id))
      for (const msg of wsHistory) {
        // 只添加 REST API 中没有的消息
        if (!existingIds.has(msg.id)) {
          messages.value.push({ ...msg, isSelf: msg.senderId === myUserId.value })
        }
      }
      // 滚动到底部
      scrollToBottom(chatContainerRef.value)
    },
    // 在线用户全量快照回调（onlineUserIds 的**唯一**写入方）
    //
    // 服务端每次都是全量集合，这里必须整体覆盖而不是增量增删 ——
    // member-joined / member-left 会被重复投递或丢失（断线重连、多标签页、事件重放），
    // 用它们做增量加减会让在线集合永久漂移，且无法自愈。
    onPresence: (data) => {
      if (data.roomId !== roomId.value) return
      onlineUserIds.value = new Set(data.onlineUserIds)
    },
    // 收到新消息回调（其他人发的）
    onNewMessage: (msg: WSMessage) => {
      // 过滤掉自己发送的消息，只添加其他人的消息
      if (msg.senderId === myUserId.value) return
      // 将新消息添加到消息列表末尾
      messages.value.push({ ...msg, isSelf: false })
      // 滚动到底部
      scrollToBottom(chatContainerRef.value)
    },
    // 自己消息发送成功回调
    onMessageSent: (msg: WSMessage) => {
      // 用 server 返回的真实消息替换掉最新的临时消息
      let idx = -1
      for (let i = messages.value.length - 1; i >= 0; i--) {
        if (messages.value[i].isTemp) {
          idx = i
          break
        }
      }
      if (idx !== -1) {
        messages.value[idx] = { ...msg, isSelf: true }
      } else {
        // 如果没找到临时消息，则追加新消息
        messages.value.push({ ...msg, isSelf: true })
      }
      // 滚动到底部
      scrollToBottom(chatContainerRef.value)
    },
    // 其他成员加入回调（仅成员关系是**新增**时服务端才会广播）
    onMemberJoined: (data) => {
      if (data.roomId !== roomId.value) return
      // 按 userId 幂等 upsert：该事件可能重复投递（重连、多标签页），裸 push 会出重复行
      const idx = members.value.findIndex(m => m.userId === data.userId)
      if (idx === -1) {
        members.value.push({
          id: 0, roomId: data.roomId, userId: data.userId,
          username: data.username, joinedAt: Date.now(),
        })
      } else {
        members.value[idx] = { ...members.value[idx], username: data.username }
      }
      // 不写 onlineUserIds：紧随其后的 presence 全量快照才是权威
      // 显示加入提示
      showToast(`${data.username} 加入了房间`)
    },
    // 其他成员离开回调（该用户已无任何 socket 在该房间）
    onMemberLeft: (data) => {
      if (data.roomId !== roomId.value) return
      // 只提示，**不**从 members 里删除 —— 他仍然是房间成员（持久关系），只是离线了。
      // 他是否在线由 onPresence 的全量快照决定，成员名册与在线状态是两回事。
      showToast(`${data.username} 离开了房间`)
    },
  }

  // 调用连接函数建立 WebSocket 连接
  try {
    connectWebSocket(handlers)
    // 连接已建立（或是复用已连接的 socket），此后离开页面需要向服务端声明 leave-room
    wsBound = true
  } catch (err: any) {
    // 连接失败时显示错误
    showToast(err.message || 'WebSocket 连接失败')
  }
}

// 滚动事件处理函数（滚动到顶部时加载更多历史消息）
function onScroll(event: Event) {
  const target = event.target as HTMLElement
  // 如果滚动位置接近顶部（距离顶部小于 50px）
  if (target.scrollTop < 50) {
    // 触发加载更多
    loadMore()
  }
}

// 发送消息的异步函数
async function handleSend() {
  // 获取输入框中的文本并去除首尾空格
  const text = inputText.value.trim()
  // 如果文本为空或 WebSocket 未连接，则直接返回
  if (!text || !isWsConnected.value) return

  // 先在 UI 中添加一个临时消息（乐观更新）
  const tempMsg: UIMessage = {
    id: Date.now(),             // 临时 ID
    roomId: roomId.value,       // 房间 ID
    senderId: myUserId.value,   // 当前用户 ID
    senderName: '我',            // 临时用户名
    content: text,              // 消息内容
    createdAt: Date.now(),      // 当前时间戳
    isSelf: true,               // 标记为自己发送
    isTemp: true,               // 标记为临时消息
  }
  // 将临时消息添加到消息列表
  messages.value.push(tempMsg)

  // 清空输入框
  inputText.value = ''

  // 通过 WebSocket 发送消息（server 会做 DTO 校验）
  sendRoomMessage(roomId.value, text)

  // 滚动到底部
  await scrollToBottom(chatContainerRef.value)
}

/**
 * 统一的离场清理（幂等）
 *
 * handleBack 里的 router.back() 会紧接着触发 onUnmounted，两条路径此前各自
 * emit 一次 leave-room + clearWebSocketHandlers，于是房间内其他人会收到**两条**
 * 「离开」提示。用 tornDown 把两条路径收敛成一次。
 *
 * 这里只做两件事：离开 Socket.IO 房间（在线状态的生灭）+ 解绑本组件的 handler。
 * 它**不**调用 POST /chat/leave —— 那是「退出房间」，会终止持久成员关系，
 * 下次进入房间就会 403「您不在该房间中」。离开页面 ≠ 退出房间。
 */
function teardown() {
  if (tornDown) return
  tornDown = true
  // 未建立 WS 通道时服务端本就不在这个房间，emit 只会带来一次无意义的 presence 广播
  if (wsBound && roomId.value) leaveRoom(roomId.value)
  // 清空本组件绑定的全部 socket 事件监听。socket 是模块级单例，这里只解绑 handler、
  // 不 disconnect（下一行没调 disconnectWebSocket），避免反复握手。
  // 说明：目前**只有本组件**用 WebSocket（RoomList 走的是 REST），
  // 所以「留给其他场景复用」是预留而非现状；也正因为没人 disconnect，
  // 这个 socket 会一直存活到页面卸载。将来若有登出流程，记得在那里断开。
  clearWebSocketHandlers()
}

/**
 * 返回上一页
 *
 * 不能无条件用 router.back()：深链进入（直接打开 /chat/5、从外部链接或通知跳入）时
 * 浏览器历史里没有本站的上一条记录，back() 会把用户直接弹出应用。
 * 只有确实存在上一条站内记录时才回退，否则落到房间列表。
 */
function goBack() {
  if (window.history.state?.back) router.back()
  else router.replace('/rooms')
}

// 返回按钮处理函数
function handleBack() {
  teardown()
  goBack()
}

// 切换成员面板显示/隐藏的函数
function toggleMemberPanel() {
  showMemberPanel.value = !showMemberPanel.value
}

// 组件卸载时执行的清理函数（handleBack 已清理过时是空操作）
onUnmounted(() => {
  teardown()
})

// 从共享模块中导入日期格式化工具
import { formatDate } from '@project/shared'
// 从组合式函数中导入滚动到底部工具
import { useScrollToBottom as scrollToBottom } from '@/composables/useScrollToBottom'
</script>

<!-- template 模板块：定义聊天室页面的 HTML 结构 -->
<template>
  <!-- 聊天室页面外层容器 -->
  <div class="chat-room-page">
    <!-- 顶部导航栏 -->
    <van-nav-bar left-arrow @click-left="handleBack">
      <!-- 自定义标题：房间名称 + 在线人数 -->
      <template #title>
        <span class="room-title">{{ roomName }}</span>
        <span class="room-online">
          <span class="online-dot-small"></span>
          {{ onlineUserIds.size }}人在线
        </span>
      </template>
      <!-- 右侧插槽：放置成员面板切换按钮 -->
      <template #right>
        <van-icon name="friends-o" size="20" @click="toggleMemberPanel" />
      </template>
    </van-nav-bar>

    <!-- 断线提示横幅 -->
    <van-notice-bar v-if="!isWsConnected" color="#ed6a0c" bg-color="#fffbe8" left-icon="info-o">
      连接中...
    </van-notice-bar>

    <!-- 消息列表区域 -->
    <div ref="chatContainerRef" class="chat-container" @scroll="onScroll">
      <!-- 加载更多历史消息提示 -->
      <div v-if="loadingHistory" class="history-loading">
        <van-loading size="16px">加载中...</van-loading>
      </div>

      <!-- 遍历消息列表，渲染每条消息 -->
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="message-row"
        :class="msg.isSelf ? 'message-self' : 'message-other'"
      >
        <!-- 头像 -->
        <div class="avatar">
          <van-icon name="user-o" size="28" color="#1989fa" />
        </div>
        <!-- 消息气泡容器 -->
        <div class="message-bubble">
          <!-- 他人消息时显示发送者名称 -->
          <div v-show="!msg.isSelf" class="sender-name">{{ msg.senderName }}</div>
          <!-- 消息内容 -->
          <div class="message-content">{{ msg.content }}</div>
          <!-- 消息发送时间 -->
          <div class="message-time">{{ formatDate(msg.createdAt, 'HH:mm') }}</div>
        </div>
      </div>
    </div>

    <!-- 底部输入区域 -->
    <div class="input-area">
      <!-- Vant 文本输入框 -->
      <van-field
        v-model="inputText"
        type="textarea"
        placeholder="输入消息..."
        :autosize="{ maxHeight: 100, minHeight: 40 }"
        :disabled="!isWsConnected"
        @keydown.enter.exact.prevent="handleSend"
      />
      <!-- 发送按钮 -->
      <van-button
        type="primary"
        size="small"
        round
        :disabled="!inputText.trim() || !isWsConnected"
        @click="handleSend"
      >
        发送
      </van-button>
    </div>

    <!-- 成员面板侧滑弹窗 -->
    <van-popup
      v-model:show="showMemberPanel"
      position="right"
      :style="{ width: '75%' }"
      class="member-popup"
    >
      <!-- 弹窗头部 -->
      <div class="member-header">
        <div class="member-title">房间成员 ({{ members.length }})</div>
        <van-icon name="cross" size="18" @click="showMemberPanel = false" />
      </div>
      <!-- 成员列表 -->
      <div class="member-list">
        <div v-for="member in members" :key="member.userId" class="member-item">
          <van-icon name="user-o" size="24" color="#1989fa" />
          <span class="member-username">{{ member.username }}</span>
          <!-- 在线状态指示点 -->
          <span
            class="online-dot"
            :class="{ online: onlineUserIds.has(member.userId) }"
          ></span>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<!-- style 样式块：定义聊天室页面的局部样式 -->
<style lang="scss" scoped>
// 聊天室页面容器样式
.chat-room-page {
  // 使用 flex 布局
  display: flex;
  // 垂直排列
  flex-direction: column;
  // 高度占满整个视口
  height: 100vh;
  // 背景色为浅灰色
  background: #f5f5f5;
  // 隐藏溢出内容
  overflow: hidden;
}

// 导航栏标题区域样式
.room-title {
  // 字体大小 16px
  font-size: 16px;
  // 字体颜色深灰
  color: #323233;
  // 字体粗细 500
  font-weight: 500;
}

// 在线人数指示器样式
.room-online {
  // 字体大小 11px
  font-size: 11px;
  // 字体颜色浅灰
  color: #969799;
  // 左侧间距 8px
  margin-left: 8px;
}

// 在线状态小圆点
.online-dot-small {
  // 行内块元素
  display: inline-block;
  // 宽高 6px
  width: 6px;
  height: 6px;
  // 圆角 50%
  border-radius: 50%;
  // 绿色表示在线
  background: #07c160;
  // 右侧间距 4px
  margin-right: 4px;
  // 垂直居中对齐
  vertical-align: middle;
}

// 消息列表容器样式
.chat-container {
  // flex 子项占满剩余空间
  flex: 1;
  // 垂直方向可滚动
  overflow-y: auto;
  // 四周内边距 12px
  padding: 12px;
  // 启用 iOS 原生滚动回弹效果
  -webkit-overflow-scrolling: touch;
}

// 历史消息加载中提示样式
.history-loading {
  // 文字居中
  text-align: center;
  // 底部外边距 12px
  margin-bottom: 12px;
  // 字体大小 12px
  font-size: 12px;
  // 字体颜色浅灰
  color: #969799;
}

// 消息行通用样式
.message-row {
  // 使用 flex 布局
  display: flex;
  // 子项顶部对齐
  align-items: flex-start;
  // 底部外边距 12px
  margin-bottom: 12px;
  // 子元素间距 8px
  gap: 8px;
  // 宽度占满父容器，确保 flex 方向反转有效
  width: 100%;
}

// 自己发送的消息行样式
.message-self {
  // 头像排到最后（右侧）
  .avatar {
    order: 2;
  }

  // 气泡排到前面（左侧），靠右对齐
  .message-bubble {
    // 背景色为主题蓝色
    background: #1989fa;
    // 文字颜色为白色
    color: #fff;
    // 圆角样式（左上角直角）
    border-radius: 12px 2px 12px 12px;
    // 左侧自动边距，气泡靠右
    margin-left: auto;
  }

  // 自己的消息时间右对齐
  .message-time {
    text-align: right;
  }
}

// 其他人发送的消息行样式
.message-other {
  // 气泡样式
  .message-bubble {
    // 背景色为白色
    background: #fff;
    // 文字颜色为深灰
    color: #323233;
    // 圆角样式（右上角直角）
    border-radius: 2px 12px 12px 12px;
    // 添加轻微阴影
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  }
}

// 头像容器样式
.avatar {
  // 不允许收缩
  flex-shrink: 0;
}

// 消息气泡通用样式
.message-bubble {
  // 最大宽度为父容器的 70%
  max-width: 70%;
  // 内边距上下 8px 左右 12px
  padding: 8px 12px;
  // 字体大小 14px
  font-size: 14px;
  // 行高 1.5
  line-height: 1.5;
  // 单词换行时允许在任意位置断开
  word-break: break-word;
}

// 发送者名称样式
.sender-name {
  // 字体大小 12px
  font-size: 12px;
  // 字体颜色浅灰
  color: #969799;
  // 底部间距 4px
  margin-bottom: 4px;
}

// 消息内容通用样式
.message-content {
  // 保留空白和换行符
  white-space: pre-wrap;
}

// 消息时间样式
.message-time {
  // 字体大小 10px
  font-size: 10px;
  // 透明度 60%
  opacity: 0.6;
  // 顶部外边距 4px
  margin-top: 4px;
}

// 底部输入区域样式
.input-area {
  // 不允许收缩
  flex-shrink: 0;
  // 使用 flex 布局
  display: flex;
  // 子项底部对齐
  align-items: flex-end;
  // 子元素间距 8px
  gap: 8px;
  // 四周内边距
  padding: 8px 12px;
  // 底部内边距适配安全区域
  padding-bottom: max(8px, env(safe-area-inset-bottom));
  // 背景色白色
  background: #fff;
  // 顶部边框线
  border-top: 1px solid #ebedf0;

  // 穿透修改 Vant Field 组件内部样式
  :deep(.van-field) {
    // flex 子项占满剩余空间
    flex: 1;
    // 无内边距
    padding: 0;
    // 背景透明
    background: transparent;
  }

  // 穿透修改 Vant Field 输入控件样式
  :deep(.van-field__control) {
    // 字体大小 14px
    font-size: 14px;
  }
}

// 成员面板弹窗样式
.member-popup {
  // 高度占满整个视口
  height: 100vh;
  // 使用 flex 布局
  display: flex;
  // 垂直排列
  flex-direction: column;

  // 面板头部
  .member-header {
    // 使用 flex 布局
    display: flex;
    // 子项居中对齐
    align-items: center;
    // 子项两端对齐
    justify-content: space-between;
    // 内边距 16px
    padding: 16px;
    // 底部边框线
    border-bottom: 1px solid #ebedf0;

    // 标题文字
    .member-title {
      // 字体大小 16px
      font-size: 16px;
      // 字体颜色深灰
      color: #323233;
      // 字体粗细 500
      font-weight: 500;
    }
  }

  // 成员列表容器
  .member-list {
    // flex 子项占满剩余空间
    flex: 1;
    // 垂直方向可滚动
    overflow-y: auto;
    // 内边距 12px
    padding: 12px;
  }

  // 单个成员项样式
  .member-item {
    // 使用 flex 布局
    display: flex;
    // 子项垂直居中
    align-items: center;
    // 内边距上下 10px 左右 8px
    padding: 10px 8px;
    // 子元素间距 10px
    gap: 10px;
    // 底部边框线
    border-bottom: 1px solid #f5f5f5;

    // 用户名
    .member-username {
      // flex 子项占满剩余空间
      flex: 1;
      // 字体大小 14px
      font-size: 14px;
      // 字体颜色深灰
      color: #323233;
    }

    // 在线状态指示点
    .online-dot {
      // 宽高 8px 的圆点
      width: 8px;
      height: 8px;
      // 圆角 50%
      border-radius: 50%;
      // 默认灰色（离线）
      background: #c8c9cc;

      // 在线时绿色
      &.online {
        background: #07c160;
      }
    }
  }
}
</style>
