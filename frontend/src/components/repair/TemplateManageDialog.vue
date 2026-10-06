<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Plus } from '@element-plus/icons-vue'
import { useRepairStore } from '@/stores/repairStore'
import { useRepairTemplateStore } from '@/stores/repairTemplateStore'
import type { RepairTemplate } from '@/types/repairTemplate'
import TemplateEditDialog from './TemplateEditDialog.vue'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
}>()

const repairStore = useRepairStore()
const templateStore = useRepairTemplateStore()

const dialogVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

const editVisible = ref(false)
const editingTemplate = ref<RepairTemplate | null>(null)

function severityText(template: RepairTemplate): string {
  return template.severities.length === 0 ? '不限程度' : template.severities.join(' / ')
}

function stepsText(template: RepairTemplate): string {
  return template.steps.map((step, index) => `${index + 1}.${step.name}`).join(' → ')
}

/** 有历史工序引用的模板：删除 / 停用提示中说明历史工序仍可识别 */
function usageCount(template: RepairTemplate): number {
  return repairStore.steps.filter((step) => step.templateId === template.id).length
}

function openCreate(): void {
  editingTemplate.value = null
  editVisible.value = true
}

function openEdit(template: RepairTemplate): void {
  editingTemplate.value = template
  editVisible.value = true
}

async function toggleActive(template: RepairTemplate, active: boolean): Promise<void> {
  if (active) {
    await templateStore.setActive(template.id, true)
    ElMessage.success(`模板「${template.name}」已启用`)
    return
  }
  const count = usageCount(template)
  const confirmed = await ElMessageBox.confirm(
    `停用后批量生成时不能再选择「${template.name}」。${count > 0 ? `已有 ${count} 道历史工序来自该模板，停用后仍可在时间线中识别其来源。` : ''}`,
    '停用模板',
    { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  await templateStore.setActive(template.id, false)
  ElMessage.success(`模板「${template.name}」已停用`)
}

async function remove(template: RepairTemplate): Promise<void> {
  const count = usageCount(template)
  const confirmed = await ElMessageBox.confirm(
    `确定删除自定义模板「${template.name}」？${count > 0 ? `已有 ${count} 道历史工序来自该模板，删除后这些工序仍保留，来源标记仍显示模板名称。` : ''}删除后不可恢复。`,
    '删除模板',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  await templateStore.removeTemplate(template.id)
  ElMessage.success('模板已删除')
}
</script>

<template>
  <el-dialog v-model="dialogVisible" title="工序模板管理" width="860px">
    <div class="manage__head">
      <p class="muted">
        模板含名称、工序顺序、适用程度与默认材料；批量生成时以模板当时内容写入，之后修改模板不影响已生成的历史工序。
      </p>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建模板</el-button>
    </div>

    <el-table :data="templateStore.templates" size="small" class="manage__table">
      <el-table-column label="模板名称" min-width="170">
        <template #default="{ row }">
          <div class="manage__name">
            <strong>{{ row.name }}</strong>
            <el-tag v-if="row.builtin" size="small" type="info" effect="plain">内置</el-tag>
            <el-tag v-if="!row.active" size="small" type="danger" effect="plain">已停用</el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="适用程度" width="150">
        <template #default="{ row }">{{ severityText(row) }}</template>
      </el-table-column>
      <el-table-column label="工序顺序" min-width="240" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="manage__steps">{{ stepsText(row) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="引用工序" width="90" align="center">
        <template #default="{ row }">
          <el-tag size="small" effect="plain" round>{{ usageCount(row) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态 / 操作" width="210">
        <template #default="{ row }">
          <div class="manage__actions">
            <el-switch
              :model-value="row.active"
              inline-prompt
              active-text="启用"
              inactive-text="停用"
              @update:model-value="(value: boolean) => toggleActive(row, value)"
            />
            <el-button size="small" text :icon="Edit" @click="openEdit(row)">编辑</el-button>
            <el-button
              v-if="!row.builtin"
              size="small"
              text
              type="danger"
              :icon="Delete"
              @click="remove(row)"
            >
              删除
            </el-button>
            <el-tooltip v-else content="内置模板不可删除，如不再需要可停用" placement="top">
              <el-button size="small" text type="danger" :icon="Delete" disabled>删除</el-button>
            </el-tooltip>
          </div>
        </template>
      </el-table-column>
      <template #empty>
        <span class="muted">暂无模板，点击右上角「新建模板」开始维护。</span>
      </template>
    </el-table>

    <TemplateEditDialog v-model:visible="editVisible" :template="editingTemplate" />
  </el-dialog>
</template>

<style scoped>
.manage__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.manage__head p {
  margin: 0;
  max-width: 560px;
  font-size: 12px;
}

.manage__table {
  border: 1px solid var(--line);
  border-radius: 8px;
}

.manage__name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.manage__steps {
  font-size: 12px;
  color: #6b6257;
}

.manage__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
