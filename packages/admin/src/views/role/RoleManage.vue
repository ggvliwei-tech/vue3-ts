<script setup lang="ts">
/**
 * 角色管理页
 * - 角色列表 / 新建 / 编辑 / 删除 / 配置权限
 * - 权限码：role:list / role:create / role:update / role:delete / role:assign-permission
 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  getRoleDetail,
  assignPermissionsById,
  type Role,
  type CreateRoleParams,
  type UpdateRoleParams,
} from '@/api/role'
import { listPermissionsGrouped, type Permission } from '@/api/permission'
import { formatDate } from '@project/shared'

// ========== 列表状态 ==========
const list = ref<Role[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')

// ========== 新建/编辑对话框 ==========
const editDialogVisible = ref(false)
const editFormRef = ref<FormInstance>()
const editMode = ref<'create' | 'edit'>('create')
const editingId = ref<number | null>(null)
const editForm = reactive<CreateRoleParams & { status: number }>({
  code: '',
  name: '',
  description: '',
  status: 1,
  permissionCodes: [],
})

const editRules: FormRules = {
  code: [
    { required: true, message: '请输入角色编码', trigger: 'blur' },
    { pattern: /^[a-z][a-z0-9_]*$/i, message: '只能包含字母、数字、下划线，且以字母开头', trigger: 'blur' },
    { max: 50, message: '长度不能超过 50', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
}

// ========== 权限配置对话框 ==========
const permDialogVisible = ref(false)
const permDialogLoading = ref(false)
const permDialogSubmitting = ref(false)
const permTree = ref<Permission[]>([]) // 全量权限（按模块分组后扁平化）
const permTreeByModule = ref<Record<string, Permission[]>>({})
const currentRole = ref<Role | null>(null)
const checkedPermIds = ref<number[]>([])

// ========== 方法 ==========

/** 加载列表 */
async function loadList() {
  loading.value = true
  try {
    const res = await listRoles({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
    })
    list.value = res.data.list
    total.value = res.data.total
  } catch (e: any) {
    ElMessage.error(e.message || '加载角色列表失败')
  } finally {
    loading.value = false
  }
}

/** 关键字搜索 */
function handleSearch() {
  page.value = 1
  loadList()
}

/** 分页变化 */
function handlePageChange(p: number) {
  page.value = p
  loadList()
}
function handleSizeChange(s: number) {
  pageSize.value = s
  page.value = 1
  loadList()
}

/** 打开新建对话框 */
function handleCreate() {
  editMode.value = 'create'
  editingId.value = null
  Object.assign(editForm, {
    code: '',
    name: '',
    description: '',
    status: 1,
    permissionCodes: [],
  })
  editDialogVisible.value = true
}

/** 打开编辑对话框 */
async function handleEdit(row: Role) {
  editMode.value = 'edit'
  editingId.value = row.id
  try {
    const res = await getRoleDetail(row.id)
    Object.assign(editForm, {
      code: res.data.code,
      name: res.data.name,
      description: res.data.description || '',
      status: res.data.status,
      permissionCodes: res.data.permissions.map((p) => p.code),
    })
    editDialogVisible.value = true
  } catch (e: any) {
    ElMessage.error(e.message || '加载角色详情失败')
  }
}

/** 提交新建/编辑 */
async function handleSubmit() {
  if (!editFormRef.value) return
  await editFormRef.value.validate(async (valid) => {
    if (!valid) return
    try {
      if (editMode.value === 'create') {
        await createRole({
          code: editForm.code,
          name: editForm.name,
          description: editForm.description || undefined,
          status: editForm.status,
          permissionCodes: editForm.permissionCodes?.filter(Boolean),
        })
        ElMessage.success('创建成功')
      } else {
        const data: UpdateRoleParams = {
          name: editForm.name,
          description: editForm.description || undefined,
          status: editForm.status,
        }
        await updateRole(editingId.value!, data)
        // 编辑模式下权限变更通过独立的「配置权限」对话框处理
        ElMessage.success('更新成功')
      }
      editDialogVisible.value = false
      loadList()
    } catch (e: any) {
      ElMessage.error(e.message || '操作失败')
    }
  })
}

/** 删除角色 */
async function handleDelete(row: Role) {
  await ElMessageBox.confirm(`确定要删除角色「${row.name}」吗？该操作不可恢复！`, '警告', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning',
  })
  try {
    await deleteRole(row.id)
    ElMessage.success('删除成功')
    loadList()
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败')
  }
}

/** 打开权限配置对话框 */
async function handleConfigPerm(row: Role) {
  currentRole.value = row
  permDialogVisible.value = true
  permDialogLoading.value = true
  try {
    // 并发：当前角色的权限 + 全量权限
    const [detailRes, groupedRes] = await Promise.all([
      getRoleDetail(row.id),
      listPermissionsGrouped(),
    ])
    permTreeByModule.value = groupedRes.data
    permTree.value = Object.values(groupedRes.data).flat()
    checkedPermIds.value = detailRes.data.permissions.map((p) => p.id)
  } catch (e: any) {
    ElMessage.error(e.message || '加载权限数据失败')
    permDialogVisible.value = false
  } finally {
    permDialogLoading.value = false
  }
}

/** 提交权限配置 */
async function handleSubmitPerm() {
  if (!currentRole.value) return
  permDialogSubmitting.value = true
  try {
    await assignPermissionsById(currentRole.value.id, checkedPermIds.value)
    ElMessage.success('权限配置成功')
    permDialogVisible.value = false
    loadList()
  } catch (e: any) {
    ElMessage.error(e.message || '权限配置失败')
  } finally {
    permDialogSubmitting.value = false
  }
}

/** 工具：按模块渲染权限树 */
function getModuleList(): string[] {
  return Object.keys(permTreeByModule.value)
}

// 初始化
onMounted(loadList)
</script>

<template>
  <div class="role-manage">
    <!-- 过滤区 -->
    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" class="filter-form">
        <el-form-item label="关键字">
          <el-input
            v-model="keyword"
            placeholder="角色编码 / 名称"
            clearable
            style="width: 220px"
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">查询</el-button>
          <el-button @click="keyword = ''; handleSearch()">重置</el-button>
        </el-form-item>
        <el-form-item style="float: right">
          <el-button type="success" @click="handleCreate">+ 新建角色</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 列表 -->
    <el-card class="list-card" shadow="never">
      <el-table :data="list" v-loading="loading" border stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="code" label="编码" width="160">
          <template #default="{ row }">
            <el-tag size="small">{{ row.code }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" width="160" />
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
            <el-button type="warning" size="small" @click="handleConfigPerm(row)">配置权限</el-button>
            <el-button
              type="danger"
              size="small"
              :disabled="['admin', 'user', 'editor'].includes(row.code)"
              @click="handleDelete(row)"
            >
              删除
            </el-button>
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
      v-model="editDialogVisible"
      :title="editMode === 'create' ? '新建角色' : '编辑角色'"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="100px">
        <el-form-item label="角色编码" prop="code">
          <el-input
            v-model="editForm.code"
            placeholder="英文编码，如 auditor"
            :disabled="editMode === 'edit'"
          />
        </el-form-item>
        <el-form-item label="角色名称" prop="name">
          <el-input v-model="editForm.name" placeholder="中文名" />
        </el-form-item>
        <el-form-item label="角色描述">
          <el-input v-model="editForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="editForm.status">
            <el-radio :value="1">启用</el-radio>
            <el-radio :value="0">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="editMode === 'create'" label="初始权限">
          <el-input
            v-model="editForm.permissionCodes"
            placeholder="可选，逗号分隔，如 user:list,book:create"
          />
          <div class="form-tip">多个权限码用英文逗号分隔，不填则不绑定任何权限</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="false" @click="handleSubmit">确认</el-button>
      </template>
    </el-dialog>

    <!-- 权限配置对话框 -->
    <el-dialog
      v-model="permDialogVisible"
      :title="`配置权限 - ${currentRole?.name || ''}`"
      width="780px"
      :close-on-click-modal="false"
    >
      <div v-loading="permDialogLoading">
        <el-alert
          type="info"
          :closable="false"
          title="提示：勾选要授予该角色的权限，保存后立即生效（已登录用户需重新登录或等待权限缓存过期）"
          style="margin-bottom: 16px"
        />
        <div class="perm-modules">
          <div v-for="module in getModuleList()" :key="module" class="perm-module">
            <div class="module-title">{{ module }}</div>
            <el-checkbox-group v-model="checkedPermIds" class="perm-group">
              <el-checkbox
                v-for="perm in permTreeByModule[module]"
                :key="perm.id"
                :value="perm.id"
                class="perm-item"
              >
                <span class="perm-code">{{ perm.code }}</span>
                <span class="perm-name">{{ perm.name }}</span>
              </el-checkbox>
            </el-checkbox-group>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="permDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="permDialogSubmitting" @click="handleSubmitPerm">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.role-manage {
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
.form-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin-top: 4px;
}
.perm-modules {
  max-height: 480px;
  overflow-y: auto;
}
.perm-module {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 12px;
  background: #fafbfc;
}
.module-title {
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
  text-transform: uppercase;
  font-size: 13px;
}
.perm-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.perm-item {
  display: flex;
  align-items: center;
  margin-right: 0 !important;
}
.perm-code {
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 12px;
  color: #409eff;
  margin-right: 8px;
}
.perm-name {
  color: #606266;
  font-size: 13px;
}
</style>
