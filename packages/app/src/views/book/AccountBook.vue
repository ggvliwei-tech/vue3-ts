<!-- script setup 块：使用 Composition API 语法糖定义账本列表页面逻辑 -->
<script setup lang="ts">
// 从 vue 中导入 ref（响应式引用）和 onMounted（组件挂载生命周期钩子）
import { ref, onMounted } from 'vue'
// 从 vue-router 中导入 useRouter 函数用于路由导航
import { useRouter } from 'vue-router'
// 从账本 API 模块中导入相关函数和类型
import {
  getAccountBookList,  // 获取账本列表接口
  deleteAccountBook,   // 删除账本接口
  createAccountBook,   // 新增账本接口
  updateAccountBook,   // 更新账本接口
  type AccountBook,     // 账本数据类型
  type CreateAccountBookParams,  // 新增账本参数类型
} from '@/api/accountBook'
// 从共享模块中导入日期格式化函数
import { formatDate } from '@project/shared'
// 从 vant 中导入轻提示、对话框和加载提示组件方法
import { showToast, showDialog, showLoadingToast, closeToast } from 'vant'

// 获取路由导航实例
const router = useRouter()

// 定义加载状态的响应式数据
const loading = ref(false)
// 定义下拉刷新状态的响应式数据
const refreshing = ref(false)
// 定义是否已加载完所有数据的响应式数据
const finished = ref(false)
// 定义账本列表数据的响应式数组
const accountBooks = ref<AccountBook[]>([])
// 定义当前页码的响应式数据
const page = ref(1)
// 定义每页条数常量
const limit = 10
// 防止首次挂载时 van-list 重复触发 onLoad 的标记
const isInitialLoad = ref(true)

// 弹窗相关状态定义
// 控制弹窗显示/隐藏的响应式数据
const showPopup = ref(false)
// 标识当前弹窗是编辑模式还是新增模式的响应式数据
const isEdit = ref(false)
// 当前正在编辑的账本 ID（null 表示新增模式）
const editingId = ref<number | null>(null)
// 弹窗表单数据的响应式对象
const popupFormData = ref({
  websiteName: '',    // 网站名称
  websiteUrl: '',     // 网站地址
  loginAccount: '',   // 登录账号
  loginPassword: '',  // 登录密码
})

// 加载账本数据的异步函数，isRefresh 参数控制是否为刷新操作
async function loadData(isRefresh = false) {
  // 如果是刷新操作，重置页码和状态
  if (isRefresh) {
    // 重置页码为 1
    page.value = 1
    // 重置加载完成状态为 false
    finished.value = false
    // 清空账本列表数据
    accountBooks.value = []
  }

  // 如果已加载完所有数据或正在加载中，则直接返回
  if (finished.value || loading.value) return

  // 设置加载状态为 true
  loading.value = true

  // 使用 try-catch 捕获网络请求可能抛出的异常
  try {
    // 调用获取账本列表 API，传入当前页码和每页条数
    const res = await getAccountBookList({ page: page.value, limit })
    // 从响应数据中解构出列表数据和总记录数
    const { list, total } = res.data

    // 如果是刷新操作则替换列表，否则追加到现有列表后面
    accountBooks.value = isRefresh ? list : [...accountBooks.value, ...list]
    // 判断是否已加载完所有数据：当前列表长度大于等于总记录数
    finished.value = accountBooks.value.length >= total
    // 如果列表中有数据，则页码加 1 为下一次加载做准备
    if (accountBooks.value.length > 0) {
      page.value++
    }
  } catch (err: any) {
    // 请求失败时弹出错误提示
    showToast(err.message || '加载失败')
    // 请求失败时终止 loading，防止 van-list 无限重试
    finished.value = true
  } finally {
    // 无论成功还是失败，都重置加载和刷新状态
    loading.value = false
    refreshing.value = false
    // 首次加载完成，将标记设为 false
    isInitialLoad.value = false
  }
}

// 下拉刷新回调函数
function onRefresh() {
  // 设置刷新状态为 true
  refreshing.value = true
  // 重置加载完成状态
  finished.value = false
  // 以刷新模式重新加载数据
  loadData(true)
}

// van-list 触底加载回调函数
function onLoad() {
  // 如果是首次加载或已加载完所有数据，则直接返回
  if (isInitialLoad.value || finished.value) {
    // 将首次加载标记设为 false
    isInitialLoad.value = false
    return
  }
  // 正常加载下一页数据
  loadData()
}

// 点击新增按钮的回调函数
function onAdd() {
  // 设置弹窗为新增模式
  isEdit.value = false
  // 清空编辑 ID
  editingId.value = null
  // 重置表单数据为空
  popupFormData.value = {
    websiteName: '',
    websiteUrl: '',
    loginAccount: '',
    loginPassword: '',
  }
  // 显示弹窗
  showPopup.value = true
}

// 点击编辑按钮的回调函数，接收要编辑的账本项
function onEdit(item: AccountBook) {
  // 设置弹窗为编辑模式
  isEdit.value = true
  // 记录当前编辑的账本 ID
  editingId.value = item.id
  // 将账本数据填充到表单中（密码字段不回填）
  popupFormData.value = {
    websiteName: item.websiteName,
    websiteUrl: item.websiteUrl,
    loginAccount: item.loginAccount,
    loginPassword: '',
  }
  // 显示弹窗
  showPopup.value = true
}

// 点击删除按钮的回调函数，接收要删除的账本项
async function onDelete(item: AccountBook) {
  // 使用 try-catch 捕获对话框操作可能抛出的异常
  try {
    // 弹出确认删除对话框，显示要删除的账本名称
    await showDialog({
      title: '确认删除',
      message: `确定要删除账本"${item.websiteName}"吗？`,
      showCancelButton: true,
    })

    // 显示加载中的提示
    showLoadingToast({ message: '删除中...', forbidClick: true, duration: 0 })
    // 调用删除账本 API
    await deleteAccountBook(item.id)
    // 弹出删除成功提示
    showToast('删除成功')
    // 刷新列表数据
    onRefresh()
  } catch (err: any) {
    // 如果不是用户取消操作，则显示错误提示
    if (err.message !== 'cancel') {
      showToast(err.message || '删除失败')
    }
  } finally {
    // 关闭 Toast 提示
    closeToast()
  }
}

// 弹窗表单提交回调函数
async function onSubmit() {
  // 校验网站名称是否为空
  if (!popupFormData.value.websiteName) {
    // 为空时弹出提示
    showToast('请输入网站名称')
    return
  }
  // 校验登录账号是否为空
  if (!popupFormData.value.loginAccount) {
    // 为空时弹出提示
    showToast('请输入登录账号')
    return
  }
  // 新增模式下校验密码是否为空
  if (!isEdit.value && !popupFormData.value.loginPassword) {
    // 为空时弹出提示
    showToast('请输入登录密码')
    return
  }

  // 使用 try-catch 捕获提交请求可能抛出的异常
  try {
    // 显示提交中的加载提示
    showLoadingToast({ message: '提交中...', forbidClick: true, duration: 0 })

    // 如果是编辑模式且存在编辑 ID
    if (isEdit.value && editingId.value) {
      // 复制表单数据到参数对象
      const params: any = { ...popupFormData.value }
      // 如果密码为空，则从参数中删除该字段（表示不修改密码）
      if (!params.loginPassword) {
        delete params.loginPassword
      }
      // 调用更新账本 API
      await updateAccountBook(editingId.value, params)
      // 弹出更新成功提示
      showToast('更新成功')
    // 如果是新增模式
    } else {
      // 调用新增账本 API
      await createAccountBook(popupFormData.value as CreateAccountBookParams)
      // 弹出新增成功提示
      showToast('新增成功')
    }

    // 关闭弹窗
    showPopup.value = false
    // 刷新列表数据
    onRefresh()
  } catch (err: any) {
    // 提交失败时弹出错误提示
    showToast(err.message || '操作失败')
  } finally {
    // 关闭 Toast 提示
    closeToast()
  }
}

// 复制网站 URL 到剪贴板的函数
function onCopyUrl(url: string) {
  // 检查浏览器是否支持剪贴板 API
  if (navigator.clipboard) {
    // 将 URL 写入剪贴板，成功后显示提示
    navigator.clipboard.writeText(url).then(() => showToast('已复制'))
  }
}

// 复制登录账号到剪贴板的函数
function onCopyAccount(account: string) {
  // 检查浏览器是否支持剪贴板 API
  if (navigator.clipboard) {
    // 将账号写入剪贴板，成功后显示提示
    navigator.clipboard.writeText(account).then(() => showToast('已复制'))
  }
}

// 组件挂载后执行的钩子函数
onMounted(() => {
  // 以刷新模式加载账本数据
  loadData(true)
})
</script>

<!-- template 模板块：定义账本列表页面的 HTML 结构 -->
<template>
  <!-- 账本列表页面外层容器 -->
  <div class="account-book-page">
    <!-- Vant 导航栏组件，标题为"账本列表"，左侧带返回箭头 -->
    <van-nav-bar title="账本列表" left-arrow @click-left="router.back()" />

    <!-- 账本列表内容区域 -->
    <div class="account-book-content">
      <!-- Vant 下拉刷新组件，v-model 绑定刷新状态 -->
      <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
        <!-- Vant 列表组件，支持触底自动加载 -->
        <van-list
          v-model:loading="loading"
          :finished="finished"
          finished-text="没有更多了"
          @load="onLoad"
        >
          <!-- 遍历账本列表数据，每个账本渲染为一个卡片 -->
          <van-cell-group v-for="item in accountBooks" :key="item.id" inset class="book-card">
            <!-- 账本标题单元格，显示网站名称和地址，右侧带箭头 -->
            <van-cell :title="item.websiteName" :value="item.websiteUrl" is-link>
              <!-- 右侧操作按钮区域 -->
              <template #right-icon>
                <!-- 编辑按钮，点击触发编辑函数 -->
                <van-button size="small" type="primary" @click="onEdit(item)">编辑</van-button>
                <!-- 删除按钮，点击触发删除函数 -->
                <van-button size="small" type="danger" plain @click="onDelete(item)">删除</van-button>
              </template>
            </van-cell>
            <!-- 账号单元格，显示登录账号，点击可复制 -->
            <van-cell title="账号" :value="item.loginAccount" @click="onCopyAccount(item.loginAccount)">
              <!-- 右侧复制图标 -->
              <template #right-icon>
                <van-icon name="copy" />
              </template>
            </van-cell>
            <!-- 网址单元格，仅在网址不为空时显示，点击可复制 -->
            <van-cell v-if="item.websiteUrl" title="网址" :value="item.websiteUrl" is-link @click="onCopyUrl(item.websiteUrl)">
              <!-- 右侧复制图标 -->
              <template #right-icon>
                <van-icon name="copy" />
              </template>
            </van-cell>
            <!-- 更新时间单元格，使用 formatDate 格式化时间戳 -->
            <van-cell title="更新时间" :value="formatDate(item.updatedAt)" />
          </van-cell-group>

          <!-- 当列表为空且不在加载中时，显示空状态 -->
          <van-empty v-if="!loading && accountBooks.length === 0" description="暂无账本数据" />
        </van-list>
      </van-pull-refresh>
    </div>

    <!-- 悬浮新增按钮 -->
    <van-button round type="primary" class="add-btn" @click="onAdd">
      <!-- 加号图标和文字 -->
      <van-icon name="plus" /> 新增账本
    </van-button>

    <!-- 新增/编辑弹窗 -->
    <van-popup v-model:show="showPopup" position="bottom" round :style="{ padding: '16px' }">
      <!-- 弹窗标题，根据模式显示不同文字 -->
      <h3 class="popup-title">{{ isEdit ? '编辑账本' : '新增账本' }}</h3>
      <!-- Vant 表单组件 -->
      <van-form @submit="onSubmit">
        <!-- 单元格组 -->
        <van-cell-group inset>
          <!-- 网站名称输入字段 -->
          <van-field
            v-model="popupFormData.websiteName"
            label="网站名称"
            placeholder="请输入网站名称"
            :rules="[{ required: true, message: '请输入网站名称' }]"
          />
          <!-- 网站地址输入字段（可选） -->
          <van-field
            v-model="popupFormData.websiteUrl"
            label="网站地址"
            placeholder="请输入网站地址"
          />
          <!-- 登录账号输入字段 -->
          <van-field
            v-model="popupFormData.loginAccount"
            label="登录账号"
            placeholder="请输入登录账号"
            :rules="[{ required: true, message: '请输入登录账号' }]"
          />
          <!-- 登录密码输入字段，编辑模式下不修改可留空 -->
          <van-field
            v-model="popupFormData.loginPassword"
            label="登录密码"
            :placeholder="isEdit ? '不修改请留空' : '请输入登录密码'"
            :rules="isEdit ? [] : [{ required: true, message: '请输入登录密码' }]"
            type="password"
          />
        </van-cell-group>
        <!-- 弹窗操作按钮区域 -->
        <div class="popup-btns">
          <!-- 提交按钮，根据模式显示"保存"或"新增"文字 -->
          <van-button block type="primary" native-type="submit">
            {{ isEdit ? '保存' : '新增' }}
          </van-button>
          <!-- 取消按钮，点击关闭弹窗 -->
          <van-button block class="cancel-btn" @click="showPopup = false">取消</van-button>
        </div>
      </van-form>
    </van-popup>
  </div>
</template>

<!-- style 样式块：定义账本列表页面的局部样式 -->
<style lang="scss" scoped>
// 账本列表页面容器样式
.account-book-page {
  // 使用 flex 布局
  display: flex;
  // flex 子项垂直排列
  flex-direction: column;
  // 高度占满整个视口
  height: 100vh;
  // 隐藏溢出内容
  overflow: hidden;

  // Vant 导航栏样式
  .van-nav-bar {
    // 不允许收缩，保持固定高度
    flex-shrink: 0;
  }
}

// 账本列表内容区域样式
.account-book-content {
  // flex 子项占满剩余空间
  flex: 1;
  // 垂直方向可滚动
  overflow-y: auto;
  // 背景色为浅灰色
  background: #f5f5f5;

  // 使用 :deep() 穿透修改 Vant 组件内部样式
  :deep(.van-pull-refresh) {
    // 最小高度占满容器
    min-height: 100%;
  }
}

// 账本卡片样式
.book-card {
  // 四周外边距 8px
  margin: 8px;
}

// 悬浮新增按钮样式
.add-btn {
  // 固定定位
  position: fixed;
  // 距离底部 80px
  bottom: 80px;
  // 距离右侧 20px
  right: 20px;
  // 左右内边距 20px
  padding: 0 20px;
  // 添加阴影效果
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

// 弹窗标题样式
.popup-title {
  // 底部外边距 16px，上下无外边距
  margin: 0 0 16px;
  // 文字居中对齐
  text-align: center;
  // 字体大小 16px
  font-size: 16px;
}

// 弹窗操作按钮区域样式
.popup-btns {
  // 顶部外边距 16px
  margin-top: 16px;

  // 取消按钮样式
  .cancel-btn {
    // 顶部外边距 8px
    margin-top: 8px;
    // 背景色白色
    background: #fff;
    // 字体颜色深灰
    color: #323233;
    // 边框浅灰色
    border: 1px solid #ebedf0;
  }
}
</style>
