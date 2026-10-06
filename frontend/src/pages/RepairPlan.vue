<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowDown,
  ArrowUp,
  Delete,
  Edit,
  MagicStick,
  Plus,
  Sort,
  Tickets
} from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import SeverityTag from '@/components/common/SeverityTag.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useDecayStore } from '@/stores/decayStore'
import { useHallStore } from '@/stores/hallStore'
import { useRepairStore } from '@/stores/repairStore'
import { useRepairTemplateStore } from '@/stores/repairTemplateStore'
import type { RepairGroup } from '@/types/repair'
import {
  REPAIR_STATES,
  REPAIR_STEP_NAMES,
  REPAIR_TEMPLATE_NAME_MAX,
  REPAIR_TEMPLATE_REMARK_MAX,
  REPAIR_TEMPLATE_STEP_MATERIAL_MAX,
  type RepairState,
  type RepairStep,
  type RepairStepName,
  type RepairTemplate,
  type RepairTemplateDraft
} from '@/types/repair'
import { SEVERITIES, type Severity } from '@/types/decay'
import {
  createEmptyTemplateDraft,
  createStepKey,
  draftFromTemplate,
  validateTemplateDraft,
  type TemplateDraftErrors
} from '@/utils/repairTemplateSeed'
import { formatArea } from '@/utils/severity'

const hallStore = useHallStore()
const decayStore = useDecayStore()
const repairStore = useRepairStore()
const templateStore = useRepairTemplateStore()

const hallFilter = ref<string>('')
const stateFilter = ref<RepairState | ''>('')
const draggingId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)

/** 工序材料与责任人的编辑草稿：工序 id → 字段值，失焦或回车时写回 IndexedDB */
const stepDrafts = reactive<Record<string, { material: string; operator: string }>>({})

function syncDrafts(list: RepairStep[]): void {
  const alive = new Set(list.map((step) => step.id))
  Object.keys(stepDrafts).forEach((id) => {
    if (!alive.has(id)) delete stepDrafts[id]
  })
  list.forEach((step) => {
    if (!stepDrafts[step.id]) {
      stepDrafts[step.id] = { material: step.material, operator: step.operator }
    }
  })
}

watch(() => repairStore.steps, syncDrafts, { immediate: true, deep: false })

function commitDraft(step: RepairStep, field: 'material' | 'operator'): void {
  const draft = stepDrafts[step.id]
  if (!draft) return
  const value = draft[field].trim()
  if (value === step[field]) return
  void repairStore.updateStep(step.id, { [field]: value } as Partial<RepairStep>)
}

const stepDialogVisible = ref(false)
const editingStepId = ref<string | null>(null)
const stepForm = reactive<{
  decayId: string
  name: RepairStepName
  material: string
  operator: string
  state: RepairState
}>({
  decayId: '',
  name: '除尘',
  material: '',
  operator: '',
  state: '未开始'
})

/** ===== 按模板批量生成：选择殿宇与模板 → 预览命中 → 确认写入 ===== */
const generateDialogVisible = ref(false)
const generateHallId = ref<string>('')
const generateTemplateId = ref<string>('')
const generating = ref(false)

/** ===== 工序模板维护 ===== */
const templateDialogVisible = ref(false)
const editorVisible = ref(false)
const editingTemplateId = ref<string | null>(null)
const editorDraft = reactive<RepairTemplateDraft>(createEmptyTemplateDraft())
const editorErrors = reactive<TemplateDraftErrors>({})
const savingTemplate = ref(false)

const hallOptions = computed(() =>
  hallStore.halls.map((hall) => ({ label: `${hall.name}（${hall.era}）`, value: hall.id }))
)

const activeTemplateOptions = computed(() =>
  templateStore.activeTemplates.map((template) => ({
    label: `${template.name}（适用：${template.severities.join('、')}）`,
    value: template.id
  }))
)

const selectedTemplate = computed<RepairTemplate | null>(
  () => templateStore.templateById(generateTemplateId.value) ?? null
)

/** 当前殿宇 + 模板的命中预览（响应式，纯计算不写数据） */
const preview = computed(() => {
  if (!generateHallId.value || !generateTemplateId.value) return null
  return templateStore.preview(generateTemplateId.value, generateHallId.value)
})

/** 命中预览列表中的一行：病害 + 构件名 */
interface PreviewHitItem {
  decay: import('@/types/decay').Decay
  location: string
}

/** 命中病害按程度分组展示 */
const hitGroups = computed<{ severity: Severity; items: PreviewHitItem[] }[]>(() => {
  if (!preview.value) return []
  return SEVERITIES.map((severity) => ({
    severity,
    items: preview.value!.hits
      .filter((decay) => decay.severity === severity)
      .map((decay) => {
        const row = decayStore.rows.find((item) => item.decay.id === decay.id)
        return {
          decay,
          location: row?.element?.name ?? '构件已删除'
        }
      })
  })).filter((group) => group.items.length > 0)
})

const groups = computed<RepairGroup[]>(() =>
  repairStore.groups.filter((group) => {
    if (hallFilter.value && group.element?.hallId !== hallFilter.value) return false
    if (stateFilter.value && !group.steps.some((step) => step.state === stateFilter.value)) return false
    return true
  })
)

const visibleStepCount = computed(() => groups.value.reduce((sum, group) => sum + group.steps.length, 0))

const visibleDoneCount = computed(() => groups.value.reduce((sum, group) => sum + group.doneCount, 0))

const pendingDecays = computed(() =>
  repairStore.pendingDecays.filter((decay) => {
    if (!hallFilter.value) return true
    const layer = decayStore.layers.find((item) => item.id === decay.layerId)
    const element = layer ? decayStore.elements.find((item) => item.id === layer.elementId) : undefined
    return element?.hallId === hallFilter.value
  })
)

watch(
  () => repairStore.activeDecayId,
  async (id) => {
    if (!id) return
    if (!hallFilter.value) {
      const layer = decayStore.layers.find((item) => item.id === repairStore.decayById(id)?.layerId)
      const element = layer ? decayStore.elements.find((item) => item.id === layer.elementId) : undefined
      if (element) hallFilter.value = element.hallId
    }
    await nextTick()
    const anchor = document.getElementById(`group_${id}`)
    anchor?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
)

function groupTitle(group: RepairGroup): string {
  const element = group.element
  const hall = repairStore.hallOfGroup(group)
  return `${hall?.name ?? '未知殿宇'} · ${element?.name ?? '构件已删除'} · ${group.decay?.type ?? '病害已删除'}`
}

function groupSubtitle(group: RepairGroup): string {
  const layer = group.layer
  const decay = group.decay
  if (!layer) return '层位已删除'
  const level = `第 ${layer.level} 层 ${layer.patternName}/${layer.pigment}`
  if (!decay) return level
  return `${level} · 病害 ${decay.type} · ${formatArea(decay.areaCm2)}`
}

function openStepDialog(decayId: string, step?: RepairStep): void {
  stepForm.decayId = decayId
  if (step) {
    editingStepId.value = step.id
    stepForm.name = step.name
    stepForm.material = step.material
    stepForm.operator = step.operator
    stepForm.state = step.state
  } else {
    editingStepId.value = null
    stepForm.name = '除尘'
    stepForm.material = ''
    stepForm.operator = ''
    stepForm.state = '未开始'
  }
  stepDialogVisible.value = true
}

async function submitStep(): Promise<void> {
  if (!stepForm.decayId) return
  if (editingStepId.value) {
    await repairStore.updateStep(editingStepId.value, {
      name: stepForm.name,
      material: stepForm.material.trim(),
      operator: stepForm.operator.trim(),
      state: stepForm.state
    })
    ElMessage.success('工序已更新')
  } else {
    await repairStore.addStep({
      decayId: stepForm.decayId,
      name: stepForm.name,
      material: stepForm.material.trim(),
      operator: stepForm.operator.trim(),
      state: stepForm.state
    })
    ElMessage.success('已追加修复工序')
  }
  stepDialogVisible.value = false
}

async function removeStep(step: RepairStep): Promise<void> {
  const confirmed = await ElMessageBox.confirm(`删除工序「${step.name}」？`, '删除确认', { type: 'warning' }).catch(
    () => false
  )
  if (!confirmed) return
  await repairStore.removeStep(step.id)
  ElMessage.success('工序已删除')
}

async function removeGroup(group: RepairGroup): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `清空「${groupTitle(group)}」的全部 ${group.steps.length} 道工序？`,
    '删除确认',
    { type: 'warning' }
  ).catch(() => false)
  if (!confirmed) return
  await repairStore.removeGroup(group.decayId)
  ElMessage.success('该病害的工序已清空')
}

async function changeState(step: RepairStep, state: RepairState): Promise<void> {
  await repairStore.setStepState(step.id, state)
  const group = repairStore.groupOf(step.decayId)
  if (state === '已完成' && group && group.doneCount === group.totalCount) {
    ElMessage.success('该病害全部工序完成，病害已回写为「已修复」')
  } else {
    ElMessage.success(`工序状态已改为「${state}」`)
  }
}

function onDragStart(step: RepairStep): void {
  draggingId.value = step.id
}

function onDragOver(step: RepairStep, event: DragEvent): void {
  event.preventDefault()
  dragOverId.value = step.id
}

async function onDrop(group: RepairGroup, target: RepairStep): Promise<void> {
  const sourceId = draggingId.value
  draggingId.value = null
  dragOverId.value = null
  if (!sourceId || sourceId === target.id) return
  const ordered = group.steps.map((step) => step.id).filter((id) => id !== sourceId)
  const targetIndex = ordered.indexOf(target.id)
  ordered.splice(targetIndex, 0, sourceId)
  await repairStore.reorder(group.decayId, ordered)
  ElMessage.success('工序顺序已调整')
}

function openGenerateDialog(): void {
  generateHallId.value = hallFilter.value || hallStore.halls[0]?.id || ''
  generateTemplateId.value = templateStore.activeTemplates[0]?.id ?? ''
  generateDialogVisible.value = true
}

/** 确认后按模板当时内容写入；无命中不写数据并说明原因 */
async function submitGenerate(): Promise<void> {
  if (!generateHallId.value) {
    ElMessage.warning('请选择殿宇')
    return
  }
  if (!generateTemplateId.value) {
    ElMessage.warning('请选择工序模板')
    return
  }
  if (!preview.value || preview.value.hits.length === 0) {
    ElMessage.warning(noHitReason())
    return
  }
  const hallName = hallStore.hallById(generateHallId.value)?.name ?? '该殿宇'
  const templateName = selectedTemplate.value?.name ?? ''
  const confirmed = await ElMessageBox.confirm(
    `将按模板「${templateName}」为「${hallName}」的 ${preview.value.hits.length} 条命中病害生成 ${preview.value.stepCount} 道工序。已有工序不参与，是否继续？`,
    '确认生成工序',
    { type: 'info', confirmButtonText: '确认生成', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return

  generating.value = true
  try {
    const result = await templateStore.generate(generateTemplateId.value, generateHallId.value)
    if (!result.generated || result.decayCount === 0) {
      ElMessage.warning(noHitReason())
      return
    }
    // 与时间线殿宇筛选联动，方便生成后立即查看
    hallFilter.value = generateHallId.value
    generateDialogVisible.value = false
    ElMessage.success(`已生成 ${result.stepCount} 道工序（覆盖 ${result.decayCount} 条病害），可逐条调整材料与责任人`)
  } finally {
    generating.value = false
  }
}

/** 无命中的可读原因：优先殿宇，再模板程度，再已有工序 */
function noHitReason(): string {
  if (!generateHallId.value) return '请先选择目标殿宇'
  const hallName = hallStore.hallById(generateHallId.value)?.name ?? '该殿宇'
  const totalInHall = decayStore.rows.filter((row) => row.hallId === generateHallId.value).length
  if (totalInHall === 0) return `「${hallName}」下没有病害记录，未生成任何工序`
  if (!preview.value) return '请选择工序模板'
  if (preview.value.missCounts.severityMismatch > 0 && preview.value.missCounts.hasSteps === 0) {
    const levels = selectedTemplate.value?.severities.join('、') ?? ''
    return `「${hallName}」没有程度为「${levels}」的病害，未生成任何工序`
  }
  if (preview.value.missCounts.hasSteps > 0 && preview.value.missCounts.severityMismatch === 0) {
    return `「${hallName}」的病害均已安排工序，已有工序不参与模板生成`
  }
  return `「${hallName}」没有命中的病害（程度不符或已有工序），未生成任何工序`
}

function openTemplateDialog(): void {
  templateDialogVisible.value = true
}

function openEditorCreate(): void {
  editingTemplateId.value = null
  Object.assign(editorDraft, createEmptyTemplateDraft())
  Object.keys(editorErrors).forEach((key) => delete editorErrors[key as keyof TemplateDraftErrors])
  editorVisible.value = true
}

function openEditorEdit(template: RepairTemplate): void {
  editingTemplateId.value = template.id
  Object.assign(editorDraft, draftFromTemplate(template))
  Object.keys(editorErrors).forEach((key) => delete editorErrors[key as keyof TemplateDraftErrors])
  editorVisible.value = true
}

function addEditorStep(): void {
  editorDraft.steps.push({ key: createStepKey(), name: '除尘', material: '' })
}

function removeEditorStep(index: number): void {
  editorDraft.steps.splice(index, 1)
}

function moveEditorStep(index: number, delta: -1 | 1): void {
  const target = index + delta
  if (target < 0 || target >= editorDraft.steps.length) return
  const list = editorDraft.steps
  ;[list[index], list[target]] = [list[target], list[index]]
}

async function submitEditor(): Promise<void> {
  const errors = validateTemplateDraft(editorDraft, templateStore.templates, editingTemplateId.value ?? undefined)
  editorErrors.name = errors.name
  editorErrors.severities = errors.severities
  editorErrors.steps = errors.steps
  if (errors.name || errors.severities || errors.steps) return

  savingTemplate.value = true
  try {
    if (editingTemplateId.value) {
      await templateStore.updateTemplate(editingTemplateId.value, editorDraft)
      ElMessage.success('模板已更新；已生成的历史工序保持不变')
    } else {
      await templateStore.createTemplate(editorDraft)
      ElMessage.success('模板已创建')
    }
    editorVisible.value = false
  } finally {
    savingTemplate.value = false
  }
}

async function toggleTemplateActive(template: RepairTemplate): Promise<void> {
  if (template.active) {
    const confirmed = await ElMessageBox.confirm(
      `停用模板「${template.name}」后将不能再选择它生成工序；已生成的历史工序仍保留来源标记。是否停用？`,
      '停用模板',
      { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' }
    ).catch(() => false)
    if (!confirmed) return
  }
  await templateStore.setActive(template.id, !template.active)
  ElMessage.success(template.active ? '模板已停用' : '模板已重新启用')
  // 若生成对话框中正选着被停用的模板，清空选择以免提交失效模板
  if (!template.active && generateTemplateId.value === template.id) {
    generateTemplateId.value = templateStore.activeTemplates[0]?.id ?? ''
  }
}

async function removeTemplate(template: RepairTemplate): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `删除模板「${template.name}」？删除后不能再选择它生成工序，但已生成的历史工序仍保留模板名称快照，备份数据也不受影响。`,
    '删除模板',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  await templateStore.removeTemplate(template.id)
  if (generateTemplateId.value === template.id) {
    generateTemplateId.value = templateStore.activeTemplates[0]?.id ?? ''
  }
  ElMessage.success('模板已删除，历史工序来源仍可识别')
}

function handleEmptyAction(): void {
  const first = pendingDecays.value[0]
  if (first) openStepDialog(first.id)
}

const stepNameOptions = REPAIR_STEP_NAMES
const stateOptions = REPAIR_STATES
const severityOptions = SEVERITIES
</script>

<template>
  <div>
    <div class="page-title">
      <div>
        <h2>修复工序时间线</h2>
        <p>
          共 {{ repairStore.totalSteps }} 道工序，已完成 {{ repairStore.doneSteps }} 道，进行中
          {{ repairStore.runningSteps }} 道；当前筛选 {{ groups.length }} 组 / {{ visibleStepCount }} 道
        </p>
      </div>
      <div class="page-title__actions">
        <el-button :icon="Tickets" @click="openTemplateDialog">工序模板</el-button>
        <el-button type="primary" :icon="MagicStick" @click="openGenerateDialog">按模板批量生成</el-button>
        <el-button
          :icon="Plus"
          :disabled="pendingDecays.length === 0"
          @click="handleEmptyAction"
        >
          为待编排病害排工序
        </el-button>
      </div>
    </div>

    <div class="stat-row">
      <StatBadge
        label="工序总数"
        :value="repairStore.totalSteps"
        suffix="道"
        icon="Files"
        tone="primary"
        :percent="repairStore.overallPercent"
      />
      <StatBadge label="已完成" :value="repairStore.doneSteps" suffix="道" icon="SuccessFilled" tone="success" />
      <StatBadge label="进行中" :value="repairStore.runningSteps" suffix="道" icon="Loading" tone="warning" />
      <StatBadge label="待编排病害" :value="pendingDecays.length" suffix="条" icon="WarningFilled" tone="danger" />
      <StatBadge
        label="整体完成率"
        :value="repairStore.overallPercent"
        suffix="%"
        icon="TrendCharts"
        tone="success"
        show-percent
        :percent="repairStore.overallPercent"
      />
      <StatBadge
        label="本次筛选完成"
        :value="visibleDoneCount"
        suffix="道"
        icon="Histogram"
        :percent="visibleStepCount ? Math.round((visibleDoneCount / visibleStepCount) * 100) : 0"
      />
    </div>

    <div class="section-card toolbar">
      <span class="toolbar__label">殿宇</span>
      <el-select v-model="hallFilter" clearable placeholder="全部殿宇" class="toolbar__select">
        <el-option v-for="item in hallOptions" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>

      <span class="toolbar__label">工序状态</span>
      <el-radio-group v-model="stateFilter" size="small">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button v-for="item in stateOptions" :key="item" :value="item">{{ item }}</el-radio-button>
      </el-radio-group>

      <span class="toolbar__label">排序</span>
      <el-radio-group
        :model-value="repairStore.sortMode"
        size="small"
        @update:model-value="(value: string | number | boolean | undefined) => repairStore.setSortMode(value === 'severity' ? 'severity' : 'manual')"
      >
        <el-radio-button value="manual">手动顺序</el-radio-button>
        <el-radio-button value="severity">按病害程度</el-radio-button>
      </el-radio-group>

      <el-tag v-if="repairStore.totalSteps > 0" type="info" effect="plain" round>
        <el-icon><Sort /></el-icon>
        拖拽工序卡片可调整先后
      </el-tag>
    </div>

    <div v-if="pendingDecays.length > 0" class="section-card pending">
      <div class="section-card__head">
        <h3>待编排病害（{{ pendingDecays.length }}）</h3>
        <span class="muted">这些病害尚无任何修复工序</span>
      </div>
      <div class="pending__list">
        <el-tag
          v-for="decay in pendingDecays"
          :key="decay.id"
          closable
          :disable-transitions="true"
          type="warning"
          effect="plain"
          @close="openStepDialog(decay.id)"
        >
          {{ decay.type }} / {{ decay.severity }} / {{ formatArea(decay.areaCm2) }}
        </el-tag>
      </div>
      <p class="muted pending__hint">点击标签右侧「×」即可为该病害新增第一道工序。</p>
    </div>

    <div v-if="groups.length > 0" class="timeline">
      <article
        v-for="group in groups"
        :id="`group_${group.decayId}`"
        :key="group.decayId"
        class="timeline__group"
        :class="{ 'is-active': repairStore.activeDecayId === group.decayId }"
      >
        <header class="timeline__head">
          <div>
            <h3>{{ groupTitle(group) }}</h3>
            <p class="muted">{{ groupSubtitle(group) }}</p>
          </div>
          <div class="timeline__head-right">
            <SeverityTag v-if="group.decay" :severity="group.decay.severity" size="small" plain />
            <el-tag :type="group.percent === 100 ? 'success' : 'info'" effect="plain" round>
              {{ group.doneCount }}/{{ group.totalCount }}（{{ group.percent }}%）
            </el-tag>
            <el-button size="small" type="danger" text :icon="Delete" @click="removeGroup(group)">清空</el-button>
          </div>
        </header>

        <el-progress :percentage="group.percent" :stroke-width="8" :show-text="false" class="timeline__progress" />

        <ol class="timeline__steps">
          <li
            v-for="(step, index) in group.steps"
            :key="step.id"
            class="step-card"
            :class="{
              'is-dragging': draggingId === step.id,
              'is-over': dragOverId === step.id && draggingId !== step.id,
              [`is-${step.state}`]: true
            }"
            draggable="true"
            @dragstart="onDragStart(step)"
            @dragover="onDragOver(step, $event)"
            @drop="onDrop(group, step)"
            @dragend="
              () => {
                draggingId = null
                dragOverId = null
              }
            "
          >
            <div class="step-card__seq">
              <el-icon><Sort /></el-icon>
              <span class="mono">{{ index + 1 }}</span>
            </div>
            <div class="step-card__body">
              <div class="step-card__title">
                <strong>{{ step.name }}</strong>
                <el-tag
                  v-if="step.templateName"
                  size="small"
                  effect="plain"
                  type="warning"
                  class="step-card__tpl"
                  :title="`由模板「${step.templateName}」生成，保存的是生成当时的内容`"
                >
                  {{ step.templateName }}
                </el-tag>
                <el-tag size="small" effect="plain" :type="step.state === '已完成' ? 'success' : step.state === '进行中' ? 'warning' : 'info'">
                  {{ step.state }}
                </el-tag>
              </div>
              <div class="step-card__fields">
                <el-input
                  v-model="stepDrafts[step.id].material"
                  size="small"
                  placeholder="材料 / 配比"
                  class="step-card__input"
                  @blur="commitDraft(step, 'material')"
                  @keyup.enter="commitDraft(step, 'material')"
                />
                <el-input
                  v-model="stepDrafts[step.id].operator"
                  size="small"
                  placeholder="责任人"
                  class="step-card__input"
                  @blur="commitDraft(step, 'operator')"
                  @keyup.enter="commitDraft(step, 'operator')"
                />
              </div>
            </div>
            <div class="step-card__actions">
              <el-select
                :model-value="step.state"
                size="small"
                class="step-card__state"
                @update:model-value="(value: RepairState) => changeState(step, value)"
              >
                <el-option v-for="item in stateOptions" :key="item" :label="item" :value="item" />
              </el-select>
              <el-button size="small" text :icon="Edit" @click="openStepDialog(group.decayId, step)">编辑</el-button>
              <el-button size="small" text type="danger" @click="removeStep(step)">删除</el-button>
            </div>
          </li>
        </ol>

        <div class="timeline__add">
          <el-button size="small" :icon="Plus" @click="openStepDialog(group.decayId)">追加工序</el-button>
        </div>
      </article>
    </div>

    <div v-else class="section-card">
      <EmptyPanel
        :title="repairStore.totalSteps === 0 ? '尚未安排修复工序' : '当前筛选下没有工序'"
        :description="
          repairStore.totalSteps === 0
            ? '可在「工序模板」中维护按病害程度的标准工序链，再按殿宇预览命中病害并批量生成；也可以为单条病害手动追加工序。'
            : '可切换殿宇或工序状态筛选条件。'
        "
        :action-text="pendingDecays.length > 0 ? '为待编排病害排工序' : ''"
        :secondary-text="repairStore.totalSteps === 0 ? '按模板批量生成' : ''"
        @action="handleEmptyAction"
        @secondary="openGenerateDialog"
      />
    </div>

    <el-dialog v-model="stepDialogVisible" :title="editingStepId ? '编辑工序' : '新增修复工序'" width="540px">
      <el-form :model="stepForm" label-width="110px">
        <el-form-item label="工序名称">
          <el-select v-model="stepForm.name" class="full-width">
            <el-option v-for="item in stepNameOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="材料 / 配比">
          <el-input v-model="stepForm.material" placeholder="如：鱼鳔胶（2% 明矾水调和）" maxlength="60" />
        </el-form-item>
        <el-form-item label="责任人">
          <el-input v-model="stepForm.operator" placeholder="如：李文博" maxlength="20" />
        </el-form-item>
        <el-form-item label="工序状态">
          <el-radio-group v-model="stepForm.state">
            <el-radio v-for="item in stateOptions" :key="item" :value="item">{{ item }}</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="stepDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitStep">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="generateDialogVisible" title="按模板批量生成工序" width="720px">
      <el-form label-width="100px">
        <el-form-item label="目标殿宇">
          <el-select v-model="generateHallId" class="full-width" placeholder="选择殿宇">
            <el-option v-for="item in hallOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="工序模板">
          <el-select
            v-model="generateTemplateId"
            class="full-width"
            placeholder="选择启用中的模板"
            :no-data-text="'暂无可用模板，请先在「工序模板」中新建或启用'"
          >
            <el-option v-for="item in activeTemplateOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
      </el-form>

      <div v-if="selectedTemplate" class="tpl-summary">
        <div class="tpl-summary__head">
          <strong>{{ selectedTemplate.name }}</strong>
          <el-tag v-for="level in selectedTemplate.severities" :key="level" size="small" effect="plain">
            {{ level }}
          </el-tag>
        </div>
        <p class="muted tpl-summary__steps">
          工序顺序：<template v-for="(step, index) in selectedTemplate.steps" :key="step.key">
            <span class="tpl-summary__step">{{ index + 1 }}. {{ step.name }}<template v-if="step.material">（{{ step.material }}）</template></span>
          </template>
        </p>
        <p v-if="selectedTemplate.remark" class="muted tpl-summary__remark">{{ selectedTemplate.remark }}</p>
      </div>

      <div v-if="preview" class="preview-box">
        <div class="preview-box__head">
          <span>
            将命中 <strong class="preview-box__num">{{ preview.hits.length }}</strong> 条病害，
            每条 {{ preview.stepsPerDecay }} 道工序，共生成
            <strong class="preview-box__num">{{ preview.stepCount }}</strong> 道工序
          </span>
          <el-tag type="info" effect="plain">
            轻度 {{ preview.severityCounts.轻度 }} / 中度 {{ preview.severityCounts.中度 }} / 重度 {{ preview.severityCounts.重度 }}
          </el-tag>
        </div>

        <el-alert
          v-if="preview.hits.length === 0"
          :title="noHitReason()"
          type="warning"
          :closable="false"
          show-icon
          class="preview-box__alert"
        />

        <div v-if="hitGroups.length > 0" class="preview-hits">
          <div v-for="group in hitGroups" :key="group.severity" class="preview-hits__group">
            <div class="preview-hits__title">
              <SeverityTag :severity="group.severity" size="small" plain />
              <span class="muted">{{ group.items.length }} 条</span>
            </div>
            <el-tag
              v-for="item in group.items"
              :key="item.decay.id"
              type="warning"
              effect="plain"
              class="preview-hits__tag"
            >
              {{ item.location }} · {{ item.decay.type }} · {{ formatArea(item.decay.areaCm2) }}
            </el-tag>
          </div>
        </div>

        <p v-if="preview.misses.length > 0" class="muted preview-box__miss">
          本殿宇另有 {{ preview.misses.length }} 条病害不写入：
          <template v-if="preview.missCounts.hasSteps > 0">{{ preview.missCounts.hasSteps }} 条已有工序</template>
          <template v-if="preview.missCounts.hasSteps > 0 && preview.missCounts.severityMismatch > 0">；</template>
          <template v-if="preview.missCounts.severityMismatch > 0">
            {{ preview.missCounts.severityMismatch }} 条程度不在模板适用范围
          </template>
          。已有工序一律不参与。
        </p>
      </div>

      <p class="muted">
        生成时以模板当前内容为准；生成后再修改、停用或删除模板，都不会改动这些工序。
      </p>
      <template #footer>
        <el-button @click="generateDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="generating"
          :disabled="!preview || preview.hits.length === 0"
          @click="submitGenerate"
        >
          确认生成
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="templateDialogVisible" title="工序模板维护" width="780px">
      <div class="tpl-manage__head">
        <span class="muted">停用或删除模板不影响已生成的历史工序，其来源标记与备份仍可识别。</span>
        <el-button type="primary" size="small" :icon="Plus" @click="openEditorCreate">新建模板</el-button>
      </div>

      <el-empty v-if="templateStore.templates.length === 0" description="还没有工序模板，先新建一个" />
      <el-table v-else :data="templateStore.templates" size="small" class="tpl-manage__table">
        <el-table-column label="模板名称" min-width="150">
          <template #default="{ row }">
            <strong>{{ row.name }}</strong>
            <el-tag v-if="row.builtin" size="small" type="info" effect="plain" class="tpl-manage__builtin">内置</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="适用程度" width="170">
          <template #default="{ row }">
            <el-tag v-for="level in row.severities" :key="level" size="small" effect="plain" class="tpl-manage__sev">
              {{ level }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="工序顺序" min-width="220">
          <template #default="{ row }">
            <span v-for="(step, index) in row.steps" :key="step.key" class="tpl-manage__step">
              {{ index + 1 }}.{{ step.name }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.active ? 'success' : 'info'" size="small" effect="plain">
              {{ row.active ? '启用中' : '已停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" align="right">
          <template #default="{ row }">
            <el-button size="small" text :icon="Edit" @click="openEditorEdit(row)">编辑</el-button>
            <el-button size="small" text @click="toggleTemplateActive(row)">
              {{ row.active ? '停用' : '启用' }}
            </el-button>
            <el-button size="small" text type="danger" @click="removeTemplate(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button @click="templateDialogVisible = false">关闭</el-button>
        <el-button type="primary" :icon="Plus" @click="openEditorCreate">新建模板</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="editorVisible"
      :title="editingTemplateId ? '编辑工序模板' : '新建工序模板'"
      width="640px"
      append-to-body
    >
      <el-form label-width="100px">
        <el-form-item label="模板名称" :error="editorErrors.name">
          <el-input
            v-model="editorDraft.name"
            :maxlength="REPAIR_TEMPLATE_NAME_MAX"
            show-word-limit
            placeholder="如：重度起甲抢救工序"
          />
        </el-form-item>
        <el-form-item label="适用程度" :error="editorErrors.severities">
          <el-checkbox-group v-model="editorDraft.severities">
            <el-checkbox v-for="level in severityOptions" :key="level" :value="level">{{ level }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="工序顺序" :error="editorErrors.steps">
          <div class="tpl-editor__steps">
            <div v-for="(step, index) in editorDraft.steps" :key="step.key" class="tpl-editor__row">
              <span class="tpl-editor__seq">{{ index + 1 }}</span>
              <el-select v-model="step.name" class="tpl-editor__name">
                <el-option v-for="item in stepNameOptions" :key="item" :label="item" :value="item" />
              </el-select>
              <el-input
                v-model="step.material"
                class="tpl-editor__material"
                :maxlength="REPAIR_TEMPLATE_STEP_MATERIAL_MAX"
                placeholder="默认材料 / 配比（可空）"
              />
              <el-button-group>
                <el-button :icon="ArrowUp" :disabled="index === 0" @click="moveEditorStep(index, -1)" />
                <el-button
                  :icon="ArrowDown"
                  :disabled="index === editorDraft.steps.length - 1"
                  @click="moveEditorStep(index, 1)"
                />
                <el-button type="danger" :icon="Delete" @click="removeEditorStep(index)" />
              </el-button-group>
            </div>
            <el-button size="small" :icon="Plus" @click="addEditorStep">追加一道工序</el-button>
          </div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="editorDraft.remark"
            type="textarea"
            :rows="2"
            :maxlength="REPAIR_TEMPLATE_REMARK_MAX"
            show-word-limit
            placeholder="适用病害、工艺注意事项等（可空）"
          />
        </el-form-item>
      </el-form>
      <p v-if="editingTemplateId" class="muted">
        保存后只影响之后新生成的工序；此前已由该模板生成的工序保持当时内容不变。
      </p>
      <template #footer>
        <el-button @click="editorVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingTemplate" @click="submitEditor">保存模板</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-title__actions {
  display: flex;
  gap: 8px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.toolbar__label {
  font-size: 13px;
  color: #6b6257;
}

.toolbar__select {
  width: 200px;
}

.pending__list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pending__hint {
  margin: 10px 0 0;
  font-size: 12px;
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
}

.timeline__group {
  padding: 16px;
  background: #ffffff;
  border: 1px solid var(--line);
  border-left: 4px solid #b09a76;
  border-radius: 12px;
}

.timeline__group.is-active {
  border-left-color: #8a5a2b;
  box-shadow: 0 0 0 2px rgba(138, 90, 43, 0.16);
}

.timeline__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.timeline__head h3 {
  margin: 0;
  font-size: 16px;
}

.timeline__head p {
  margin: 2px 0 0;
  font-size: 12px;
}

.timeline__head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.timeline__progress {
  margin: 10px 0 14px;
}

.timeline__steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step-card {
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  background: #fbf9f5;
  border: 1px dashed #ddd3c2;
  border-radius: 10px;
  cursor: grab;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.step-card.is-已完成 {
  border-color: #bfe0c9;
  background: #f4fbf6;
}

.step-card.is-进行中 {
  border-color: #f0d9ac;
  background: #fdf8ee;
}

.step-card.is-dragging {
  opacity: 0.5;
}

.step-card.is-over {
  border-color: #8a5a2b;
  box-shadow: 0 0 0 2px rgba(138, 90, 43, 0.18);
}

.step-card__seq {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 34px;
  color: #8a5a2b;
  font-weight: 700;
}

.step-card__body {
  flex: 1;
  min-width: 0;
}

.step-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.step-card__fields {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.step-card__input {
  flex: 1 1 180px;
  min-width: 140px;
}

.step-card__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.step-card__state {
  width: 110px;
}

.timeline__add {
  margin-top: 12px;
}

.full-width {
  width: 100%;
}

.step-card__tpl {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tpl-summary {
  margin: 4px 0 12px;
  padding: 10px 14px;
  background: #faf7f1;
  border: 1px dashed #ddd3c2;
  border-radius: 10px;
}

.tpl-summary__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.tpl-summary__steps {
  margin: 8px 0 0;
  line-height: 1.9;
}

.tpl-summary__step {
  display: inline-block;
  margin-right: 14px;
}

.tpl-summary__remark {
  margin: 4px 0 0;
  font-size: 12px;
}

.preview-box {
  margin: 4px 0 12px;
  padding: 12px 14px;
  background: #fbf9f5;
  border: 1px solid #e7ddcd;
  border-radius: 10px;
}

.preview-box__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.preview-box__num {
  font-size: 16px;
  color: #8a5a2b;
}

.preview-box__alert {
  margin-top: 10px;
}

.preview-hits {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.preview-hits__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.preview-hits__tag {
  margin: 0 8px 6px 0;
}

.preview-box__miss {
  margin: 10px 0 0;
  font-size: 12px;
}

.tpl-manage__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.tpl-manage__builtin {
  margin-left: 6px;
}

.tpl-manage__sev {
  margin-right: 4px;
}

.tpl-manage__step {
  display: inline-block;
  margin-right: 10px;
  font-size: 12px;
  color: #6b6257;
}

.tpl-editor__steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.tpl-editor__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tpl-editor__seq {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #8a5a2b;
  color: #fff;
  font-size: 12px;
  flex: none;
}

.tpl-editor__name {
  width: 110px;
  flex: none;
}

.tpl-editor__material {
  flex: 1;
  min-width: 0;
}
</style>
