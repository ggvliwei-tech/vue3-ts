<!-- script setup 块：使用 Composition API 语法糖定义文件管理页面逻辑 -->
<script setup lang="ts">
// 从 vue 中导入 ref（响应式引用）和 onMounted（组件挂载生命周期钩子）
import { ref, onMounted } from 'vue'
// 从 vue-router 中导入 useRouter 函数用于路由导航
import { useRouter } from 'vue-router'
// 从文件 API 模块中导入相关函数和类型
import {
  getFileList,    // 获取文件列表接口
  deleteFile,     // 删除文件接口
  uploadFile,     // 上传文件接口
  type FileItem,  // 文件数据类型
} from '@/api/file'
// 从共享模块中导入日期格式化函数
import { formatDate } from '@project/shared'
// 从 vant 中导入轻提示、对话框、加载提示和图片预览组件方法
import { showToast, showDialog, showLoadingToast, closeToast, showImagePreview } from 'vant'
// 从图片工具模块中导入 getImageUrl 函数
import { getImageUrl } from '@/utils/image'

// 获取路由导航实例
const router = useRouter()
// 定义文件输入框引用的响应式数据
const fileInputRef = ref<HTMLInputElement | null>(null)

// 定义加载状态的响应式数据
const loading = ref(false)
// 定义下拉刷新状态的响应式数据
const refreshing = ref(false)
// 定义是否已加载完所有数据的响应式数据
const finished = ref(false)
// 定义文件列表数据的响应式数组
const fileList = ref<FileItem[]>([])
// 定义当前页码的响应式数据
const page = ref(1)
// 定义每页条数常量
const limit = 10
// 防止首次挂载时 van-list 重复触发 onLoad 的标记
const isInitialLoad = ref(true)

// 加载文件数据的异步函数，isRefresh 参数控制是否为刷新操作
async function loadData(isRefresh = false) {
  // 如果是刷新操作，重置页码和状态
  if (isRefresh) {
    // 重置页码为 1
    page.value = 1
    // 重置加载完成状态为 false
    finished.value = false
    // 清空文件列表数据
    fileList.value = []
  }

  // 如果已加载完所有数据或正在加载中，则直接返回
  if (finished.value || loading.value) return

  // 设置加载状态为 true
  loading.value = true

  // 使用 try-catch 捕获网络请求可能抛出的异常
  try {
    // 调用获取文件列表 API，传入当前页码和每页条数
    const res = await getFileList({ page: page.value, limit })
    // 从响应数据中解构出列表数据和总记录数
    const { list, total } = res.data

    // 如果是刷新操作则替换列表，否则追加到现有列表后面
    fileList.value = isRefresh ? list : [...fileList.value, ...list]
    // 判断是否已加载完所有数据：当前列表长度大于等于总记录数
    finished.value = fileList.value.length >= total
    // 如果列表中有数据，则页码加 1 为下一次加载做准备
    if (fileList.value.length > 0) {
      page.value++
    }
  } catch (err: any) {
    // 请求失败时弹出错误提示
    showToast(err.message || '加载失败')
    // 请求失败时终止加载，防止 van-list 无限重试
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

// 触发文件选择：点击隐藏的 input 元素
function triggerUpload() {
  // 调用文件输入框的 click 方法弹出文件选择对话框
  fileInputRef.value?.click()
}

// 文件上传处理函数，接收 input 的 change 事件
async function handleUpload(event: Event) {
  // 从事件中获取 input 元素
  const target = event.target as HTMLInputElement
  // 获取用户选择的文件列表
  const files = target.files
  // 如果没有选择文件则直接返回
  if (!files || files.length === 0) return

  // 校验文件类型：仅允许图片格式
  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  // 遍历所有文件进行校验
  for (const file of files) {
    // 检查文件类型是否在允许列表中
    if (!validTypes.includes(file.type)) {
      // 类型不符合时弹出提示
      showToast('仅支持 jpg、png、gif、webp 图片格式')
      // 清空 input 值以便下次可以选择同一文件
      target.value = ''
      return
    }
    // 检查文件大小是否超过 5MB 限制
    if (file.size > 5 * 1024 * 1024) {
      // 超过限制时弹出提示并显示文件名
      showToast(`文件"${file.name}"超过 5MB 限制`)
      // 清空 input 值
      target.value = ''
      return
    }
  }

  // 使用 try-catch 捕获上传请求可能抛出的异常
  try {
    // 显示上传中的加载提示
    showLoadingToast({ message: '上传中...', forbidClick: true, duration: 0 })

    // 遍历文件逐个上传
    for (const file of files) {
      // 调用上传文件 API
      await uploadFile(file)
    }

    // 所有文件上传成功后弹出提示
    showToast('上传成功')
    // 刷新文件列表
    onRefresh()
  } catch (err: any) {
    // 上传失败时弹出错误提示
    showToast(err.message || '上传失败')
  } finally {
    // 关闭 Toast 提示
    closeToast()
    // 清空 input 值以便下次可以选择同一文件
    target.value = ''
  }
}

// 预览图片函数，接收图片在列表中的索引
function previewImage(index: number) {
  // 调用 Vant 图片预览组件
  showImagePreview({
    // 传入所有图片的完整 URL 列表
    images: getImageUrlsList(),
    // 设置从指定索引位置开始预览
    startPosition: index,
    // 显示关闭按钮
    closeable: true,
    // 显示当前图片序号
    showIndex: true,
  })
}

// 删除文件函数，接收要删除的文件项
async function onDelete(item: FileItem) {
  // 使用 try-catch 捕获对话框操作可能抛出的异常
  try {
    // 弹出确认删除对话框，显示要删除的文件名
    await showDialog({
      title: '确认删除',
      message: `确定要删除文件"${item.originalName}"吗？`,
      showCancelButton: true,
    })

    // 显示删除中的加载提示
    showLoadingToast({ message: '删除中...', forbidClick: true, duration: 0 })
    // 调用删除文件 API
    await deleteFile(item.id)
    // 弹出删除成功提示
    showToast('删除成功')
    // 刷新文件列表
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

// 获取图片 URL 列表用于预览的函数
function getImageUrlsList() {
  // 将文件列表中的每个文件 URL 转换为完整的访问地址
  return fileList.value.map((item) => getImageUrl(item.url))
}

// 格式化文件大小的函数，将字节数转换为人类可读的格式
function formatSize(bytes: number): string {
  // 如果小于 1KB，直接返回字节单位
  if (bytes < 1024) return bytes + ' B'
  // 如果小于 1MB，转换为 KB 单位保留一位小数
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  // 大于等于 1MB，转换为 MB 单位保留一位小数
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// 组件挂载后执行的钩子函数
onMounted(() => {
  // 以刷新模式加载文件数据
  loadData(true)
})
</script>

<!-- template 模板块：定义文件管理页面的 HTML 结构 -->
<template>
  <!-- 文件管理页面外层容器 -->
  <div class="file-page">
    <!-- Vant 导航栏组件，标题为"文件管理"，左侧带返回箭头 -->
    <van-nav-bar title="文件管理" left-arrow @click-left="router.back()" />

    <!-- 文件管理内容区域 -->
    <div class="file-content">
      <!-- Vant 下拉刷新组件，v-model 绑定刷新状态 -->
      <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
        <!-- Vant 列表组件，支持触底自动加载 -->
        <van-list
          v-model:loading="loading"
          :finished="finished"
          finished-text="没有更多了"
          @load="onLoad"
        >
          <!-- 文件网格列表，当有文件数据时显示 -->
          <div v-if="fileList.length > 0" class="file-grid">
            <!-- 遍历文件列表，每个文件渲染为一个卡片 -->
            <div
              v-for="(item, index) in fileList"
              :key="item.id"
              class="file-card"
            >
              <!-- 文件缩略图区域，点击触发图片预览 -->
              <div class="file-thumb" @click="previewImage(index)">
                <!-- Vant 图片组件，显示文件图片 -->
                <van-image
                  :src="getImageUrl(item.url)"
                  width="100%"
                  height="100%"
                  fit="cover"
                  radius="8px"
                  loading="lazy"
                >
                  <!-- 加载中插槽，显示旋转加载图标 -->
                  <template v-slot:loading>
                    <van-loading type="spinner" size="20" />
                  </template>
                  <!-- 加载失败插槽，显示错误图标和文字 -->
                  <template v-slot:error>
                    <div class="image-error">
                      <van-icon name="photo-fail" size="24" />
                      <span>加载失败</span>
                    </div>
                  </template>
                </van-image>
              </div>
              <!-- 文件信息区域 -->
              <div class="file-info">
                <!-- 文件名，title 属性用于悬停显示完整文件名 -->
                <div class="file-name" :title="item.originalName">{{ item.originalName }}</div>
                <!-- 文件元数据区域（大小和日期） -->
                <div class="file-meta">
                  <!-- 文件大小，使用 formatSize 函数格式化 -->
                  <span>{{ formatSize(item.size) }}</span>
                  <!-- 文件创建时间，使用 formatDate 函数格式化 -->
                  <span>{{ formatDate(item.createTime) }}</span>
                </div>
              </div>
              <!-- 删除图标按钮，位于卡片右上角 -->
              <van-icon
                name="delete-o"
                class="file-delete"
                @click="onDelete(item)"
              />
            </div>
          </div>

          <!-- 当列表为空且不在加载中时，显示空状态并包含上传按钮 -->
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
      <!-- 加号图标和文字 -->
      <van-icon name="plus" /> 上传文件
    </van-button>

    <!-- 隐藏的文件选择器，实际用于触发文件选择对话框 -->
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

<!-- style 样式块：定义文件管理页面的局部样式 -->
<style lang="scss" scoped>
// 文件管理页面容器样式
.file-page {
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

// 文件管理内容区域样式
.file-content {
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

// 文件网格布局样式
.file-grid {
  // 使用 CSS Grid 布局
  display: grid;
  // 3 列等宽布局
  grid-template-columns: repeat(3, 1fr);
  // 网格间距 8px
  gap: 8px;
  // 四周内边距 12px
  padding: 12px;
}

// 文件卡片样式
.file-card {
  // 相对定位，用于内部绝对定位元素
  position: relative;
  // 背景色白色
  background: #fff;
  // 圆角 8px
  border-radius: 8px;
  // 隐藏溢出内容
  overflow: hidden;
  // 添加阴影效果
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);

  // 缩略图区域样式
  .file-thumb {
    // 宽度占满父容器
    width: 100%;
    // 保持宽高比 1:1 正方形
    aspect-ratio: 1;
    // 鼠标悬停显示手型指针
    cursor: pointer;
    // 背景色浅灰
    background: #fafafa;

    // 图片加载失败区域样式
    .image-error {
      // 使用 flex 布局
      display: flex;
      // 垂直排列
      flex-direction: column;
      // 水平居中
      align-items: center;
      // 垂直居中
      justify-content: center;
      // 高度占满父容器
      height: 100%;
      // 字体颜色浅灰
      color: #969799;
      // 字体大小 12px
      font-size: 12px;
      // 子元素间距 4px
      gap: 4px;
    }
  }

  // 文件信息区域样式
  .file-info {
    // 内边距 8px
    padding: 8px;

    // 文件名样式
    .file-name {
      // 字体大小 12px
      font-size: 12px;
      // 字体颜色深灰
      color: #323233;
      // 溢出隐藏
      overflow: hidden;
      // 溢出时显示省略号
      text-overflow: ellipsis;
      // 不换行
      white-space: nowrap;
      // 底部外边距 4px
      margin-bottom: 4px;
    }

    // 文件元数据样式
    .file-meta {
      // 使用 flex 布局
      display: flex;
      // 两端对齐
      justify-content: space-between;
      // 字体大小 10px
      font-size: 10px;
      // 字体颜色浅灰
      color: #969799;
    }
  }

  // 删除图标按钮样式
  .file-delete {
    // 绝对定位
    position: absolute;
    // 距离顶部 4px
    top: 4px;
    // 距离右侧 4px
    right: 4px;
    // 宽度 24px
    width: 24px;
    // 高度 24px
    height: 24px;
    // 半透明黑色背景
    background: rgba(0, 0, 0, 0.5);
    // 圆形
    border-radius: 50%;
    // 图标颜色白色
    color: #fff;
    // 字体大小 14px
    font-size: 14px;
    // 使用 flex 居中
    display: flex;
    // 垂直居中
    align-items: center;
    // 水平居中
    justify-content: center;
  }
}

// 悬浮上传按钮样式
.upload-btn {
  // 固定定位
  position: fixed;
  // 距离底部 20px
  bottom: 20px;
  // 距离右侧 20px
  right: 20px;
  // 左右内边距 20px
  padding: 0 20px;
  // 添加阴影效果
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
</style>
