<!-- script setup 块：使用 Composition API 语法糖定义「我的资料」页面逻辑 -->
<script setup lang="ts">
// 从 vue 中导入 ref（响应式引用）和 onMounted（挂载生命周期钩子）
import { ref, onMounted } from 'vue'
// 从 vue-router 中导入 useRouter 用于返回上一页
import { useRouter } from 'vue-router'
// 从 AI API 模块中导入私有知识库相关函数与类型
import {
  listPrivateDocs,   // 拉取「我的资料」列表
  uploadPrivateDoc,  // 上传私有 PDF
  deletePrivateDoc,  // 删除一份私有文档
  type MyDoc,        // 文档数据类型（文档粒度，不是切块粒度）
} from '@/api/ai'
// 从共享模块中导入日期格式化函数
import { formatDate } from '@project/shared'
// 从 vant 中导入轻提示、对话框与加载提示方法
import { showToast, showDialog, showLoadingToast, closeToast } from 'vant'
// van-uploader 的 after-read 回调类型：签名必须与组件声明的 UploaderAfterRead 一致，
// 否则 vue-tsc 会因参数类型不兼容报 TS2322（UploaderFileListItem.file 是可选的）
import type { UploaderAfterRead } from 'vant'
// 权限码常量（模板里 v-permission 用到）
import { PERM } from '@/permission'

// 获取路由导航实例
const router = useRouter()

// 与服务端 FileInterceptor 的 limits.fileSize 保持一致，避免白传一趟大文件才被拒
const MAX_SIZE = 20 * 1024 * 1024

// 列表数据
const docs = ref<MyDoc[]>([])
// 首屏加载态（只有首次进入才显示 van-loading，下拉刷新走 refreshing）
const loading = ref(true)
// 下拉刷新态，供 van-pull-refresh 双向绑定
const refreshing = ref(false)
// 正在删除的 docId：用于给对应行加 loading，并防止重复点击
const deletingDocId = ref('')
// 上传中标记：van-uploader 一次可能触发多个文件，用闸门避免并发重复提交
const uploading = ref(false)

/**
 * 拉取「我的资料」列表。
 *
 * 接口是一次性返回全量数组（不分页）：私有资料是用户自己一份份传的，
 * 量级远达不到需要分页的程度，服务端也只提供了不分页的形态。
 */
async function loadDocs() {
  try {
    const res = await listPrivateDocs()
    // 用 `?? []` 兜底：服务端在无文档时返回空数组，但接口契约上 data 可能为 null
    docs.value = res.data ?? []
  } catch (err: any) {
    showToast(err?.message || '加载失败')
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

// 下拉刷新回调
async function onRefresh() {
  refreshing.value = true
  await loadDocs()
}

/**
 * van-uploader 的 after-read 回调。
 *
 * 这里不走 :before-read：两个钩子的校验结果都要靠返回 false / Promise.reject 表达，
 * 而 after-read 里我们能直接把错误文案和 toast 写在一处，逻辑更直观。
 */
const onAfterRead: UploaderAfterRead = async (items) => {
  // 关闭多选后 Vant 仍可能传数组，统一成数组处理
  const files = Array.isArray(items) ? items : [items]
  if (files.length === 0) return

  // 上传闸门：上一次还没结束就忽略后续触发（Vant 的 uploader 没有内建 loading 锁）
  if (uploading.value) return
  uploading.value = true

  try {
    for (const item of files) {
      // item.file 在类型上是可选的（Vant 也支持 dataUrl / text 结果），
      // 我们没设 result-type，实际一定是 File，这里只是把可能性收窄
      const raw = item.file
      if (!raw) continue

      // 校验类型：服务端 pdf-parse 只认 PDF，前端先拦一道，省一次无效往返
      if (raw.type !== 'application/pdf' && !raw.name.toLowerCase().endsWith('.pdf')) {
        showToast('仅支持 PDF 文件')
        continue
      }
      // 校验大小，与后端 20MB 上限一致
      if (raw.size > MAX_SIZE) {
        showToast(`文件"${raw.name}"超过 20MB 限制`)
        continue
      }

      showLoadingToast({ message: '解析中...', forbidClick: true, duration: 0 })
      const res = await uploadPrivateDoc(raw)
      closeToast()
      // 服务端切块数为 0 说明 PDF 里没有可提取的文本（扫描件 / 纯图片），
      // 这时后端会直接抛错，走不到这里；这里只处理成功路径
      showToast(`已上传，共 ${res.data.chunks} 个片段`)
    }
    // 上传完统一刷一次列表，而不是每条都刷（省请求）
    await loadDocs()
  } catch (err: any) {
    showToast(err?.message || '上传失败')
  } finally {
    // 无论成功失败都要关掉 loading toast，否则会一直盖在页面上
    closeToast()
    uploading.value = false
  }
}

/**
 * 删除一份文档（连同它的全部切块）
 * @param doc MyDoc - 列表项
 */
async function onDelete(doc: MyDoc) {
  if (deletingDocId.value) return

  try {
    await showDialog({
      title: '确认删除',
      message: `确定要删除"${doc.filename}"吗？删除后 AI 将无法再检索到它的内容。`,
      showCancelButton: true,
    })
  } catch (err) {
    // 用户点「取消」时 showDialog reject 的是字符串 'cancel'/'close'，没有 .message，
    // 所以要按值比较——沿用 FileList.vue 里已经踩过的写法
    if (err !== 'cancel' && err !== 'close') {
      showToast('删除失败')
    }
    return
  }

  deletingDocId.value = doc.docId
  const key = doc.docId
  try {
    const res = await deletePrivateDoc(key)
    // removed === 0 说明并发场景下这条已经被删掉了（比如另一个标签页）。
    // 无论哪种情况本地都该把它移出列表，所以不区分成功/已不存在
    if (res.data.removed === 0) {
      showToast('该文档已不存在')
    } else {
      showToast('删除成功')
    }
    docs.value = docs.value.filter((d) => d.docId !== key)
  } catch (err: any) {
    showToast(err?.message || '删除失败')
  } finally {
    deletingDocId.value = ''
  }
}

// 组件挂载后拉取一次列表
onMounted(() => {
  loadDocs()
})
</script>

<!-- template 模板块：定义「我的资料」页面的 HTML 结构 -->
<template>
  <div class="my-docs-page">
    <!-- 顶部导航栏，左侧返回箭头回到 AI 聊天页 -->
    <van-nav-bar title="我的资料" left-arrow @click-left="router.back()" />

    <!-- 说明区：把「这些资料谁能看到」讲清楚，这是本页最容易被误解的点 -->
    <div class="intro">
      <p class="intro-title">这些资料只有你自己能检索到</p>
      <p class="intro-desc">
        上传 PDF 后，「AI 聊天」问答时会连同公共知识库一起检索，回答里会标注出处是
        <b>公共资料</b> 还是 <b>我的资料</b>。其他用户看不到、也检索不到你上传的内容。
      </p>
    </div>

    <!-- 一份文档都没有时展示空状态；有文档时不显示，避免和新手引导打架 -->
    <van-empty v-if="!loading && docs.length === 0" image="search" description="还没有上传任何资料" />

    <!-- 列表区域：下拉可刷新 -->
    <van-pull-refresh v-if="docs.length > 0" v-model="refreshing" @refresh="onRefresh">
      <van-cell-group inset>
        <!-- van-swipe-cell 提供左滑删除；不给删除按钮单独加权限指令，
             因为能进这个页面就已经说明有 ai:doc:private 权限（路由 meta.permissions 拦过了） -->
        <van-swipe-cell v-for="doc in docs" :key="doc.docId">
          <van-cell :title="doc.filename" :label="`${doc.chunks} 个片段 · ${formatDate(doc.uploadedAt)}`">
            <template #icon>
              <van-icon name="description" class="doc-icon" />
            </template>
          </van-cell>
          <template #right>
            <van-button
              square
              type="danger"
              text="删除"
              class="delete-btn"
              :loading="deletingDocId === doc.docId"
              @click="onDelete(doc)"
            />
          </template>
        </van-swipe-cell>
      </van-cell-group>
    </van-pull-refresh>
  </div>

  <!-- 底部固定上传区：用 van-uploader 包住按钮，点击即唤起文件选择 -->
  <div class="upload-bar">
    <van-uploader
      v-permission="PERM.AI_DOC_PRIVATE"
      accept="application/pdf"
      :max-count="1"
      :after-read="onAfterRead"
      :disabled="uploading"
      class="uploader"
    >
      <van-button round block type="primary" icon="plus" :loading="uploading">
        上传 PDF
      </van-button>
    </van-uploader>
  </div>
</template>

<!-- style 样式块：scoped 表示样式仅作用于当前组件 -->
<style lang="scss" scoped>
.my-docs-page {
  display: flex;
  flex-direction: column;
  // 减去底部上传区的高度，让列表滚动区域不被遮住
  min-height: calc(100vh - 60px);
  // 底部留出上传栏的空间
  padding-bottom: 60px;
  background: #f7f8fa;

  .van-nav-bar {
    flex-shrink: 0;
  }
}

// 说明区样式
.intro {
  padding: 12px 16px 4px;

  .intro-title {
    margin: 0 0 4px;
    font-size: 14px;
    font-weight: 600;
    color: #323233;
  }

  .intro-desc {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
    color: #969799;
  }
}

// 文档图标样式
.doc-icon {
  margin-right: 8px;
  font-size: 18px;
  color: #1989fa;
}

// 删除按钮：撑满 swipe-cell 的高度
.delete-btn {
  height: 100%;
}

// 底部上传区：固定贴底
.upload-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 8px 16px;
  // 兼容 iOS 底部安全区
  padding-bottom: calc(8px + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid #ebedf0;

  // van-uploader 默认是 inline-block，撑满后按钮才能 block 布局
  .uploader {
    display: block;
  }
}
</style>
