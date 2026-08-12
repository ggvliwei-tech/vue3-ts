<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  getFileList,
  deleteFile,
  uploadFile,
  type FileItem,
} from '@/api/file'
import { formatDate } from '@project/shared'
import { showToast, showDialog, showLoadingToast, closeToast, showImagePreview } from 'vant'

const router = useRouter()
const fileInputRef = ref<HTMLInputElement | null>(null)

const loading = ref(false)
const refreshing = ref(false)
const finished = ref(false)
const fileList = ref<FileItem[]>([])
const page = ref(1)
const limit = 10
const isInitialLoad = ref(true)

async function loadData(isRefresh = false) {
  if (isRefresh) {
    page.value = 1
    finished.value = false
    fileList.value = []
  }

  if (finished.value || loading.value) return

  loading.value = true

  try {
    const res = await getFileList({ page: page.value, limit })
    const { list, total } = res.data.data

    fileList.value = isRefresh ? list : [...fileList.value, ...list]
    finished.value = fileList.value.length >= total
    if (fileList.value.length > 0) {
      page.value++
    }
  } catch (err: any) {
    showToast(err.message || '加载失败')
    finished.value = true
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

// 触发文件选择
function triggerUpload() {
  fileInputRef.value?.click()
}

// 文件上传
async function handleUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return

  // 校验文件类型
  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  for (const file of files) {
    if (!validTypes.includes(file.type)) {
      showToast('仅支持 jpg、png、gif、webp 图片格式')
      target.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast(`文件"${file.name}"超过 5MB 限制`)
      target.value = ''
      return
    }
  }

  try {
    showLoadingToast({ message: '上传中...', forbidClick: true, duration: 0 })

    // 逐个上传
    for (const file of files) {
      await uploadFile(file)
    }

    showToast('上传成功')
    onRefresh()
  } catch (err: any) {
    showToast(err.message || '上传失败')
  } finally {
    closeToast()
    target.value = ''
  }
}

// 预览图片
function previewImage(index: number) {
  showImagePreview({
    images: getImageUrls(),
    startPosition: index,
    closeable: true,
  })
}

// 删除文件
async function onDelete(item: FileItem) {
  try {
    await showDialog({
      title: '确认删除',
      message: `确定要删除文件"${item.originalName}"吗？`,
      showCancelButton: true,
    })

    showLoadingToast({ message: '删除中...', forbidClick: true, duration: 0 })
    await deleteFile(item.id)
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

// 获取图片列表用于预览
function getImageUrls() {
  return fileList.value.map((item) => item.url)
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

onMounted(() => {
  loadData(true)
})
</script>

<template>
  <div class="file-page">
    <van-nav-bar title="文件管理" left-arrow @click-left="router.back()" />

    <div class="file-content">
      <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
        <van-list
          v-model:loading="loading"
          :finished="finished"
          finished-text="没有更多了"
          @load="onLoad"
        >
          <!-- 文件网格列表 -->
          <div v-if="fileList.length > 0" class="file-grid">
            <div
              v-for="(item, index) in fileList"
              :key="item.id"
              class="file-card"
            >
              <div class="file-thumb" @click="previewImage(index)">
                <van-image
                  :src="item.url"
                  width="100%"
                  height="100%"
                  fit="cover"
                  radius="8px"
                  loading="lazy"
                >
                  <template v-slot:loading>
                    <van-loading type="spinner" size="20" />
                  </template>
                  <template v-slot:error>
                    <div class="image-error">
                      <van-icon name="photo-fail" size="24" />
                      <span>加载失败</span>
                    </div>
                  </template>
                </van-image>
              </div>
              <div class="file-info">
                <div class="file-name" :title="item.originalName">{{ item.originalName }}</div>
                <div class="file-meta">
                  <span>{{ formatSize(item.size) }}</span>
                  <span>{{ formatDate(item.createTime) }}</span>
                </div>
              </div>
              <van-icon
                name="delete-o"
                class="file-delete"
                @click="onDelete(item)"
              />
            </div>
          </div>

          <van-empty v-if="!loading && fileList.length === 0" description="暂无文件数据">
            <van-button round type="primary" @click="triggerUpload">
              上传文件
            </van-button>
          </van-empty>
        </van-list>
      </van-pull-refresh>
    </div>

    <!-- 悬浮上传按钮 -->
    <van-button round type="primary" class="upload-btn" @click="triggerUpload">
      <van-icon name="plus" /> 上传文件
    </van-button>

    <!-- 隐藏的文件选择器 -->
    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      multiple
      style="display: none"
      @change="handleUpload"
    />
  </div>
</template>

<style lang="scss" scoped>
.file-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;

  .van-nav-bar {
    flex-shrink: 0;
  }
}

.file-content {
  flex: 1;
  overflow-y: auto;
  background: #f5f5f5;

  :deep(.van-pull-refresh) {
    min-height: 100%;
  }
}

.file-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 12px;
}

.file-card {
  position: relative;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);

  .file-thumb {
    width: 100%;
    aspect-ratio: 1;
    cursor: pointer;
    background: #fafafa;

    .image-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #969799;
      font-size: 12px;
      gap: 4px;
    }
  }

  .file-info {
    padding: 8px;

    .file-name {
      font-size: 12px;
      color: #323233;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 4px;
    }

    .file-meta {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #969799;
    }
  }

  .file-delete {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 24px;
    height: 24px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 50%;
    color: #fff;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

.upload-btn {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 0 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
</style>
