<script setup lang="ts">
/**
 * 权限管理页
 * - 权限列表 / 新建 / 编辑 / 删除
 * - 权限码：permission:list / permission:create / permission:update / permission:delete
 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  listPermissions,
  listPermissionModules,
  createPermission,
  updatePermission,
  deletePermission,
  type Permission,
  type CreatePermissionParams,
  type UpdatePermissionParams,
} from '@/api/permission'
import { formatDate } from '@project/shared'

// ========== 列表状态 ==========
const list = ref<Permission[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)
const filter = reactive({
  keyword: '',
  module: '',
})

// 模块下拉选项
const moduleOptions = ref<string[]>([])

// ========== 编辑对话框 ==========
const dialogVisible = ref(false)
const dialogFormRef = ref<FormInstance>()
const mode = ref<'create' | 'edit'>('create')
const editingId = ref<number | null>(null)
const form = reactive<CreatePermissionParams>({
  code: '',
  name: '',
  module: '',
  description: '',
})

const rules: FormRules = {
  code: [
    { required: true, message: '请输入权限编码', trigger: 'blur' },
    { pattern: /^[a-z]+:[a-z0-9_-]+$/i, message: '格式应为 模块:动作，如 user:list', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入权限名称', trigger: 'blur' }],
  module: [{ required: true, message: '请输入所属模块', trigger: 'blur' }],
}

// ========== 方法 ==========
async function loadList() {
  loading.value = true
  try {
    const res = await listPermissions({
      page: page.value,
      pageSize: pageSize.value,
      keyword: filter.keyword || undefined,
      module: filter.module || undefined,
    })
    list.value = res.data.list
    total.value = res.data.total
  } catch (e: any) {
    ElMessage.error(e.message || '加载权限列表失败')
  } finally {
    loading.value = false
  }
}

async function loadModules() {
  try {
    const res = await listPermissionModules()
    moduleOptions.value = res.data
  } catch {
    // 忽略错误，不影响主功能
  }
}

function handleSearch() {
  page.value = 1
  loadList()
}

function handleReset() {
  filter.keyword = ''
  filter.module = ''
  page.value = 1
  loadList()
}

function handlePageChange(p: number) {
  page.value = p
  loadList()
}
function handleSizeChange(s: number) {
  pageSize.value = s
  page.value = 1
  loadList()
}

function handleCreate() {
  mode.value = 'create'
  editingId.value = null
  Object.assign(form, { code: '', name: '', module: '', description: '' })
  dialogVisible.value = true
}

async function handleEdit(row: Permission) {
  mode.value = 'edit'
  editingId.value = row.id
  Object.assign(form, {
    code: row.code,
    name: row.name,
    module: row.module,
    description: row.description || '',
  })
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!dialogFormRef.value) return
  await dialogFormRef.value.validate(async (valid) => {
    if (!valid) return
    try {
      if (mode.value === 'create') {
        await createPermission({
          code: form.code,
          name: form.name,
          module: form.module,
          description: form.description || undefined,
        })
        ElMessage.success('创建成功')
      } else {
        const data: UpdatePermissionParams = {
          name: form.name,
          module: form.module,
          description: form.description || undefined,
        }
        await updatePermission(editingId.value!, data)
        ElMessage.success('更新成功')
      }
      dialogVisible.value = false
      loadList()
      loadModules()
    } catch (e: any) {
      ElMessage.error(e.message || '操作失败')
    }
  })
}

async function handleDelete(row: Permission) {
  await ElMessageBox.confirm(
    `确定要删除权限「${row.name}」吗？\n若有角色正在使用该权限，将无法删除。`,
    '警告',
    { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
  )
  try {
    await deletePermission(row.id)
    ElMessage.success('删除成功')
    loadList()
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败')
  }
}

// 模块标签颜色（按模块hash取色，固定一组）
const moduleColors = ['primary', 'success', 'warning', 'info', 'danger']
function moduleTagType(module: string): 'primary' | 'success' | 'warning' | 'info' | 'danger' {
  let hash = 0
  for (let i = 0; i < module.length; i++) {
    hash = (hash * 31 + module.charCodeAt(i)) >>> 0
  }
  return moduleColors[hash % moduleColors.length] as any
}

onMounted(() => {
  loadModules()
  loadList()
})
</script>

<template>
  <div class="permission-manage">
    <!-- 过滤区 -->
    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" class="filter-form">
        <el-form-item label="关键字">
          <el-input
            v-model="filter.keyword"
            placeholder="权限编码 / 名称"
            clearable
            style="width: 220px"
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item label="所属模块">
          <el-select v-model="filter.module" placeholder="全部" clearable style="width: 160px">
            <el-option v-for="m in moduleOptions" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
        <el-form-item style="float: right">
          <el-button type="success" @click="handleCreate">+ 新建权限</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 列表 -->
    <el-card class="list-card" shadow="never">
      <el-table :data="list" v-loading="loading" border stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="code" label="权限编码" min-width="200">
          <template #default="{ row }">
            <code class="code-text">{{ row.code }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" width="160" />
        <el-table-column label="所属模块" width="120">
          <template #default="{ row }">
            <el-tag :type="moduleTagType(row.module)" size="small">{{ row.module }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="220" show-overflow-tooltip />
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
            <el-button type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        class="pagination"
        :current-page="page"
        :page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        background
        @current-change="handlePageChange"
        @size-change="handleSizeChange"
      />
    </el-card>

    <!-- 新建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="mode === 'create' ? '新建权限' : '编辑权限'"
      width="560px"
      :close-on-click-modal="false"
    >
      <el-form ref="dialogFormRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="权限编码" prop="code">
          <el-input
            v-model="form.code"
            placeholder="模块:动作，如 user:list"
            :disabled="mode === 'edit'"
          />
        </el-form-item>
        <el-form-item label="权限名称" prop="name">
          <el-input v-model="form.name" placeholder="中文名" />
        </el-form-item>
        <el-form-item label="所属模块" prop="module">
          <el-input
            v-model="form.module"
            placeholder="如 user / book / file"
            :disabled="mode === 'edit'"
          />
          <div class="form-tip">模块名用于权限分组，建议保持简短</div>
        </el-form-item>
        <el-form-item label="权限描述">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.permission-manage {
  padding: 16px;
}
.filter-card {
  margin-bottom: 16px;
}
.filter-form {
  margin-bottom: -18px;
}
.list-card :deep(.el-card__body) {
  padding: 12px;
}
.pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
.code-text {
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 12px;
  background: #f5f7fa;
  padding: 2px 6px;
  border-radius: 4px;
  color: #409eff;
}
.form-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin-top: 4px;
}
</style>
