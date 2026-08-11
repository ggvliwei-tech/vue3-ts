<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  getAccountBookList,
  deleteAccountBook,
  createAccountBook,
  updateAccountBook,
  type AccountBook,
  type CreateAccountBookParams,
} from '@/api/accountBook'
import { formatDate } from '@project/shared'
import { showToast, showDialog, showLoadingToast, closeToast } from 'vant'

const router = useRouter()

const loading = ref(false)
const refreshing = ref(false)
const finished = ref(false)
const accountBooks = ref<AccountBook[]>([])
const page = ref(1)
const limit = 10
const isInitialLoad = ref(true) // 防止首次挂载时 van-list 重复触发 onLoad

// 弹窗相关
const showPopup = ref(false)
const isEdit = ref(false)
const editingId = ref<number | null>(null)
const popupFormData = ref({
  websiteName: '',
  websiteUrl: '',
  loginAccount: '',
  loginPassword: '',
})

async function loadData(isRefresh = false) {
  if (isRefresh) {
    page.value = 1
    finished.value = false
    accountBooks.value = []
  }

  if (finished.value || loading.value) return

  loading.value = true

  try {
    const res = await getAccountBookList({ page: page.value, limit })
    const { list, total } = res.data.data

    accountBooks.value = isRefresh ? list : [...accountBooks.value, ...list]
    finished.value = accountBooks.value.length >= total
    if (accountBooks.value.length > 0) {
      page.value++
    }
  } catch (err: any) {
    showToast(err.message || '加载失败')
    finished.value = true // 请求失败时终止 loading，防止 van-list 无限重试
  } finally {
    loading.value = false
    refreshing.value = false
    isInitialLoad.value = false
  }
}

function onRefresh() {
  refreshing.value = true
  finished.value = false
  loadData(true)
}

function onLoad() {
  if (isInitialLoad.value || finished.value) {
    isInitialLoad.value = false
    return
  }
  loadData()
}

function onAdd() {
  isEdit.value = false
  editingId.value = null
  popupFormData.value = {
    websiteName: '',
    websiteUrl: '',
    loginAccount: '',
    loginPassword: '',
  }
  showPopup.value = true
}

function onEdit(item: AccountBook) {
  isEdit.value = true
  editingId.value = item.id
  popupFormData.value = {
    websiteName: item.websiteName,
    websiteUrl: item.websiteUrl,
    loginAccount: item.loginAccount,
    loginPassword: '',
  }
  showPopup.value = true
}

async function onDelete(item: AccountBook) {
  try {
    await showDialog({
      title: '确认删除',
      message: `确定要删除账本"${item.websiteName}"吗？`,
      showCancelButton: true,
    })

    showLoadingToast({ message: '删除中...', forbidClick: true, duration: 0 })
    await deleteAccountBook(item.id)
    showToast('删除成功')
    onRefresh()
  } catch (err: any) {
    if (err.message !== 'cancel') {
      showToast(err.message || '删除失败')
    }
  } finally {
    closeToast()
  }
}

async function onSubmit() {
  if (!popupFormData.value.websiteName) {
    showToast('请输入网站名称')
    return
  }
  if (!popupFormData.value.loginAccount) {
    showToast('请输入登录账号')
    return
  }
  if (!isEdit.value && !popupFormData.value.loginPassword) {
    showToast('请输入登录密码')
    return
  }

  try {
    showLoadingToast({ message: '提交中...', forbidClick: true, duration: 0 })

    if (isEdit.value && editingId.value) {
      const params: any = { ...popupFormData.value }
      if (!params.loginPassword) {
        delete params.loginPassword
      }
      await updateAccountBook(editingId.value, params)
      showToast('更新成功')
    } else {
      await createAccountBook(popupFormData.value as CreateAccountBookParams)
      showToast('新增成功')
    }

    showPopup.value = false
    onRefresh()
  } catch (err: any) {
    showToast(err.message || '操作失败')
  } finally {
    closeToast()
  }
}

function onCopyUrl(url: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast('已复制'))
  }
}

function onCopyAccount(account: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(account).then(() => showToast('已复制'))
  }
}

onMounted(() => {
  loadData(true)
})
</script>

<template>
  <div class="account-book-page">
    <van-nav-bar title="账本列表" left-arrow @click-left="router.back()" />

    <div class="account-book-content">
      <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
        <van-list
          v-model:loading="loading"
          :finished="finished"
          finished-text="没有更多了"
          @load="onLoad"
        >
          <van-cell-group v-for="item in accountBooks" :key="item.id" inset class="book-card">
            <van-cell :title="item.websiteName" :value="item.websiteUrl" is-link>
              <template #right-icon>
                <van-button size="small" type="primary" @click="onEdit(item)">编辑</van-button>
                <van-button size="small" type="danger" plain @click="onDelete(item)">删除</van-button>
              </template>
            </van-cell>
            <van-cell title="账号" :value="item.loginAccount" @click="onCopyAccount(item.loginAccount)">
              <template #right-icon>
                <van-icon name="copy" />
              </template>
            </van-cell>
            <van-cell v-if="item.websiteUrl" title="网址" :value="item.websiteUrl" is-link @click="onCopyUrl(item.websiteUrl)">
              <template #right-icon>
                <van-icon name="copy" />
              </template>
            </van-cell>
            <van-cell title="更新时间" :value="formatDate(item.updatedAt)" />
          </van-cell-group>

          <van-empty v-if="!loading && accountBooks.length === 0" description="暂无账本数据" />
        </van-list>
      </van-pull-refresh>
    </div>

    <!-- 悬浮新增按钮 -->
    <van-button round type="primary" class="add-btn" @click="onAdd">
      <van-icon name="plus" /> 新增账本
    </van-button>

    <!-- 新增/编辑弹窗 -->
    <van-popup v-model:show="showPopup" position="bottom" round :style="{ padding: '16px' }">
      <h3 class="popup-title">{{ isEdit ? '编辑账本' : '新增账本' }}</h3>
      <van-form @submit="onSubmit">
        <van-cell-group inset>
          <van-field
            v-model="popupFormData.websiteName"
            label="网站名称"
            placeholder="请输入网站名称"
            :rules="[{ required: true, message: '请输入网站名称' }]"
          />
          <van-field
            v-model="popupFormData.websiteUrl"
            label="网站地址"
            placeholder="请输入网站地址"
          />
          <van-field
            v-model="popupFormData.loginAccount"
            label="登录账号"
            placeholder="请输入登录账号"
            :rules="[{ required: true, message: '请输入登录账号' }]"
          />
          <van-field
            v-model="popupFormData.loginPassword"
            label="登录密码"
            :placeholder="isEdit ? '不修改请留空' : '请输入登录密码'"
            :rules="isEdit ? [] : [{ required: true, message: '请输入登录密码' }]"
            type="password"
          />
        </van-cell-group>
        <div class="popup-btns">
          <van-button block type="primary" native-type="submit">
            {{ isEdit ? '保存' : '新增' }}
          </van-button>
          <van-button block class="cancel-btn" @click="showPopup = false">取消</van-button>
        </div>
      </van-form>
    </van-popup>
  </div>
</template>

<style lang="scss" scoped>
.account-book-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;

  .van-nav-bar {
    flex-shrink: 0;
  }
}

.account-book-content {
  flex: 1;
  overflow-y: auto;
  background: #f5f5f5;

  :deep(.van-pull-refresh) {
    min-height: 100%;
  }
}

.book-card {
  margin: 8px;
}

.add-btn {
  position: fixed;
  bottom: 80px;
  right: 20px;
  padding: 0 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.popup-title {
  margin: 0 0 16px;
  text-align: center;
  font-size: 16px;
}

.popup-btns {
  margin-top: 16px;

  .cancel-btn {
    margin-top: 8px;
    background: #fff;
    color: #323233;
    border: 1px solid #ebedf0;
  }
}
</style>
