<script setup lang="ts">
/**
 * 公共知识库管理页
 *
 * 管理 RAG 的**公共库**（向量库里的 business_docs collection）：
 * 这里上传的 PDF 会被全站登录用户检索到，所以整个页面对应服务端的 ai:doc:manage
 * 权限码（module='admin'，因此只有 admin 角色有，editor 拿不到）。
 *
 * 与「我的资料」的区别：用户自己的私有资料在 app 端维护（user_docs_{userId}），
 * 与这里完全隔离 —— 两边都会检索到，但互相看不到对方的列表。
 *
 * 文档列表不经过 MySQL：数据源就是向量库里的 chunk metadata，
 * 按 docId 聚合后得到的文档粒度条目，所以没有"表格分页"——
 * 文档数量级由知识库规模决定，当前规模一次拉全量即可。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox, type UploadRequestOptions } from 'element-plus'
import { listDocs, uploadDoc, deleteDoc, type KnowledgeDoc } from '@/api/knowledge'
import { formatDate } from '@project/shared'

// ========== 列表状态 ==========
const docs = ref<KnowledgeDoc[]>([])
const loading = ref(false)
const uploading = ref(false)
/** 正在删除的 docId，用于给按钮单独上 loading，避免整表禁用 */
const deletingDocId = ref<string | null>(null)

/** 切块总数：列表底部给一个规模概览 */
const totalChunks = computed(() => docs.value.reduce((sum, d) => sum + d.chunks, 0))

// ========== 方法 ==========

/** 加载文档列表 */
async function loadDocs() {
  loading.value = true
  try {
    const res = await listDocs()
    docs.value = res.data ?? []
  } catch (e: any) {
    ElMessage.error(e.message || '加载知识库文档失败')
  } finally {
    loading.value = false
  }
}

/**
 * 上传前校验：类型与大小都在这里挡一道。
 * 服务端同样有 20MB 限制与 PDF 魔术字节校验，这里只是为了少一次白跑的请求，
 * **不是安全边界**。
 */
function beforeUpload(file: File) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) {
    ElMessage.error('只能上传 PDF 文件')
    return false
  }
  if (file.size > 20 * 1024 * 1024) {
    ElMessage.error('文件不能超过 20MB')
    return false
  }
  return true
}

/** 自定义上传：交给统一的 request 封装，才能带上 token 与错误处理 */
async function handleUpload(options: UploadRequestOptions) {
  uploading.value = true
  try {
    const res = await uploadDoc(options.file)
    ElMessage.success(`上传成功，已建立 ${res.data.chunks} 个索引片段`)
    // 通知 el-upload 本次上传结束（它靠这个回调清理内部状态）
    options.onSuccess?.(res)
    await loadDocs()
  } catch (e: any) {
    ElMessage.error(e.message || '上传失败')
    options.onError?.(e)
  } finally {
    uploading.value = false
  }
}

/** 删除文档（连同其全部切块） */
async function handleDelete(row: KnowledgeDoc) {
  try {
    await ElMessageBox.confirm(
      `确定要删除「${row.filename}」吗？该文档的 ${row.chunks} 个索引片段会一并删除，删除后所有用户都无法再检索到它。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    // 用户点了取消
    return
  }

  deletingDocId.value = row.docId
  try {
    const res = await deleteDoc(row.docId)
    if (res.data.removed === 0) {
      // 并发场景：别的管理员刚删掉了同一个文档
      ElMessage.warning('该文档已不存在，列表已刷新')
    } else {
      ElMessage.success('删除成功')
    }
    await loadDocs()
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败')
  } finally {
    deletingDocId.value = null
  }
}

// 初始化
onMounted(loadDocs)
</script>

<template>
  <div class="knowledge-manage">
    <!-- 上传区 -->
    <el-card class="upload-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>上传到公共知识库</span>
          <el-tooltip
            content="公共库对全站登录用户可见，请勿上传含隐私或密钥的材料"
            placement="top"
          >
            <el-tag type="warning" size="small">全站可见</el-tag>
          </el-tooltip>
        </div>
      </template>
      <el-upload
        drag
        accept=".pdf,application/pdf"
        :show-file-list="false"
        :before-upload="beforeUpload"
        :http-request="handleUpload"
        :disabled="uploading"
      >
        <div class="upload-inner">
          <div class="upload-text">
            {{ uploading ? '正在解析并建立索引…' : '将 PDF 拖到此处，或点击选择文件' }}
          </div>
          <div class="upload-tip">
            仅支持 PDF，单文件不超过 20MB。上传后会自动切块并写入向量库，可能需要几秒到数十秒。
          </div>
        </div>
      </el-upload>
    </el-card>

    <!-- 文档列表 -->
    <el-card class="list-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>知识库文档（{{ docs.length }} 个文档 / {{ totalChunks }} 个片段）</span>
          <el-button size="small" :loading="loading" @click="loadDocs">刷新</el-button>
        </div>
      </template>

      <el-table v-loading="loading" :data="docs" border stripe>
        <el-table-column prop="filename" label="文件名" min-width="260" show-overflow-tooltip />
        <el-table-column prop="chunks" label="片段数" width="100" />
        <el-table-column label="上传时间" width="180">
          <template #default="{ row }">
            <!-- uploadedAt 是毫秒时间戳；为 0 说明该 chunk 没有写 metadata（历史数据） -->
            {{ row.uploadedAt ? formatDate(row.uploadedAt) : '—' }}
          </template>
        </el-table-column>
        <el-table-column prop="docId" label="文档 ID" min-width="300" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="doc-id">{{ row.docId }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button
              type="danger"
              size="small"
              :loading="deletingDocId === row.docId"
              @click="handleDelete(row as KnowledgeDoc)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">
            知识库还没有文档。上传 PDF 后，用户提问时 AI 就能引用其中的内容。
          </div>
        </template>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.knowledge-manage {
  padding: 16px;
}
.upload-card {
  margin-bottom: 16px;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.upload-inner {
  padding: 24px 12px;
}
.upload-text {
  font-size: 14px;
  color: #606266;
}
.upload-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 8px;
  line-height: 1.5;
}
.list-card :deep(.el-card__body) {
  padding: 12px;
}
.doc-id {
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 12px;
  color: #909399;
}
.empty-tip {
  color: #909399;
  font-size: 13px;
  padding: 24px 0;
}
</style>
