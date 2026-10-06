<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { WarningFilled } from '@element-plus/icons-vue'
import { useHallStore } from '@/stores/hallStore'
import { useRepairTemplateStore } from '@/stores/repairTemplateStore'
import type { RepairTemplate } from '@/types/repairTemplate'
import SeverityTag from '@/components/common/SeverityTag.vue'
import { formatArea } from '@/utils/severity'

const props = defineProps<{
  visible: boolean
  initialHallId?: string
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'generated', stepCount: number, hitCount: number): void
}>()

const hallStore = useHallStore()
const templateStore = useRepairTemplateStore()

const hallId = ref('')
const templateId = ref('')
const generating = ref(false)

const hallOptions = computed(() =>
  hallStore.halls.map((hall) => ({ label: `${hall.name}（${hall.era}）`, value: hall.id }))
)

const templateOptions = computed(() =>
  templateStore.activeTemplates.map((template) => ({
    label: `${template.name}（${template.severities.length === 0 ? '不限程度' : template.severities.join('/')} · ${template.steps.length} 道工序）`,
    value: template.id
  }))
)

const selectedTemplate = computed<RepairTemplate | null>(
  () => templateStore.templateById(templateId.value) ?? null
)

const dialogVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    hallId.value = props.initialHallId || hallStore.halls[0]?.id || ''
    if (!templateStore.templateById(templateId.value)?.active) {
      templateId.value = templateStore.activeTemplates[0]?.id ?? ''
    }
  },
  { immediate: true }
)

/** 实时预览：按殿宇 × 模板计算命中病害与生成数量，确认后才会写入 */
const preview = computed(() => {
  if (!hallId.value || !selectedTemplate.value) return null
  return templateStore.preview(selectedTemplate.value, hallId.value)
})

const noMatchReason = computed(() => {
  if (!hallId.value || !selectedTemplate.value) return null
  return templateStore.noMatchReason(selectedTemplate.value, hallId.value)
})

async function confirmGenerate(): Promise<void> {
  const template = selectedTemplate.value
  const current = preview.value
  if (!template || !current || current.hitCount === 0) return
  const confirmed = await ElMessageBox.confirm(
    `将为殿宇下 ${current.hitCount} 条病害按模板「${template.name}」生成 ${current.totalStepCount} 道工序。已有工序的病害不参与，生成后修改模板不会影响这些工序。`,
    '确认生成',
    { type: 'warning', confirmButtonText: '确认写入', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return

  generating.value = true
  try {
    const count = await templateStore.applyTemplate(template, hallId.value)
    if (count === 0) {
      // 确认与写入之间数据发生变化（如别处已补工序），不写入并说明
      ElMessage.warning('没有可生成的病害，未写入任何工序（病害可能刚被安排过工序）')
      return
    }
    ElMessage.success(`已按模板「${template.name}」生成 ${count} 道工序`)
    emit('generated', count, current.hitCount)
    dialogVisible.value = false
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <el-dialog v-model="dialogVisible" title="按模板批量生成工序" width="760px">
    <el-form label-width="92px">
      <el-form-item label="目标殿宇">
        <el-select v-model="hallId" class="full-width" placeholder="选择殿宇">
          <el-option v-for="item in hallOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="工序模板">
        <el-select
          v-model="templateId"
          class="full-width"
          placeholder="选择启用中的模板"
          :no-data-text="'暂无启用模板，请先在「模板管理」中新建或启用'"
        >
          <el-option v-for="item in templateOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-form-item>
    </el-form>

    <div v-if="selectedTemplate" class="tpl-detail">
      <div class="tpl-detail__head">
        <strong>{{ selectedTemplate.name }}</strong>
        <div class="tpl-detail__tags">
          <el-tag
            v-for="severity in (selectedTemplate.severities.length === 0
              ? (['轻度', '中度', '重度'] as const)
              : selectedTemplate.severities)"
            :key="severity"
            size="small"
            :type="selectedTemplate.severities.length === 0 ? 'info' : 'warning'"
            effect="plain"
          >
            {{ severity }}{{ selectedTemplate.severities.length === 0 ? '（不限）' : '' }}
          </el-tag>
        </div>
      </div>
      <ol class="tpl-detail__steps">
        <li v-for="(step, index) in selectedTemplate.steps" :key="index">
          <span class="tpl-detail__seq">{{ index + 1 }}</span>
          <span class="tpl-detail__name">{{ step.name }}</span>
          <span class="muted">默认材料：{{ step.material || '（空）' }}</span>
        </li>
      </ol>
    </div>

    <div v-if="hallId && selectedTemplate" class="preview">
      <el-alert
        v-if="preview && preview.hitCount === 0 && noMatchReason"
        :title="noMatchReason"
        type="warning"
        :closable="false"
        show-icon
        :icon="WarningFilled"
      />
      <template v-else-if="preview">
        <div class="preview__summary">
          命中病害 <strong>{{ preview.hitCount }}</strong> 条，每条生成
          <strong>{{ preview.stepsPerDecay }}</strong> 道工序，共将写入
          <strong class="preview__total">{{ preview.totalStepCount }}</strong> 道
          <span class="muted">（已有工序的病害不参与）</span>
        </div>
        <el-table :data="preview.hits" size="small" max-height="280" class="preview__table">
          <el-table-column label="构件" prop="elementName" min-width="150" show-overflow-tooltip />
          <el-table-column label="彩画层位" min-width="120">
            <template #default="{ row }">
              {{ row.layerPattern }}<span v-if="row.layerPigment"> / {{ row.layerPigment }}</span>
            </template>
          </el-table-column>
          <el-table-column label="病害" prop="type" width="80" />
          <el-table-column label="程度" width="92">
            <template #default="{ row }">
              <SeverityTag :severity="row.severity" size="small" plain />
            </template>
          </el-table-column>
          <el-table-column label="面积" width="100">
            <template #default="{ row }">{{ formatArea(row.areaCm2) }}</template>
          </el-table-column>
        </el-table>
      </template>
    </div>

    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="generating"
        :disabled="!preview || preview.hitCount === 0"
        @click="confirmGenerate"
      >
        确认生成{{ preview && preview.hitCount > 0 ? `（${preview.totalStepCount} 道）` : '' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.tpl-detail {
  margin: 4px 0 14px;
  padding: 12px 14px;
  background: #faf7f1;
  border: 1px dashed #ddd3c2;
  border-radius: 10px;
}

.tpl-detail__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.tpl-detail__tags {
  display: flex;
  gap: 6px;
}

.tpl-detail__steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tpl-detail__steps li {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13px;
}

.tpl-detail__seq {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #8a5a2b;
  color: #fff;
  font-size: 12px;
}

.tpl-detail__name {
  min-width: 44px;
  font-weight: 600;
}

.preview {
  margin-top: 4px;
}

.preview__summary {
  margin-bottom: 10px;
  font-size: 14px;
}

.preview__total {
  color: #8a5a2b;
  font-size: 16px;
}

.preview__table {
  border: 1px solid var(--line);
  border-radius: 8px;
}

.full-width {
  width: 100%;
}
</style>
