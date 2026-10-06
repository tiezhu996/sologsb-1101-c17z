<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown, ArrowUp, Delete, Plus } from '@element-plus/icons-vue'
import { SEVERITIES, type Severity } from '@/types/decay'
import { REPAIR_STEP_NAMES, type RepairStepName } from '@/types/repair'
import {
  validateTemplateForm,
  type SaveTemplateInput
} from '@/stores/repairTemplateStore'
import { useRepairTemplateStore } from '@/stores/repairTemplateStore'
import type { RepairTemplate, RepairTemplateStep } from '@/types/repairTemplate'

const props = defineProps<{
  visible: boolean
  /** 传入模板为编辑；null 为新建 */
  template: RepairTemplate | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved'): void
}>()

const templateStore = useRepairTemplateStore()

const dialogVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

const isEdit = computed(() => props.template !== null)

interface FormState {
  name: string
  severities: Severity[]
  steps: RepairTemplateStep[]
}

const form = reactive<FormState>({
  name: '',
  severities: [...SEVERITIES],
  steps: [{ name: '除尘', material: '' }]
})

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    if (props.template) {
      form.name = props.template.name
      form.severities = [...props.template.severities]
      form.steps = props.template.steps.map((step) => ({ ...step }))
    } else {
      form.name = ''
      form.severities = [...SEVERITIES]
      form.steps = [{ name: '除尘', material: '' }]
    }
  },
  { immediate: true }
)

function addStep(): void {
  const used = new Set(form.steps.map((step) => step.name))
  const next = REPAIR_STEP_NAMES.find((name) => !used.has(name)) ?? '除尘'
  form.steps.push({ name: next as RepairStepName, material: '' })
}

function removeStep(index: number): void {
  form.steps.splice(index, 1)
}

function moveStep(index: number, offset: number): void {
  const target = index + offset
  if (target < 0 || target >= form.steps.length) return
  const [item] = form.steps.splice(index, 1)
  form.steps.splice(target, 0, item)
}

function toPayload(): SaveTemplateInput {
  return {
    name: form.name.trim(),
    severities: [...form.severities],
    steps: form.steps.map((step) => ({ name: step.name, material: step.material.trim() }))
  }
}

async function submit(): Promise<void> {
  const payload = toPayload()
  const error = validateTemplateForm(payload, templateStore.templates, props.template?.id)
  if (error) {
    ElMessage.warning(error)
    return
  }
  if (isEdit.value && props.template) {
    await templateStore.updateTemplate(props.template.id, payload)
    ElMessage.success('模板已更新（历史工序保持生成时内容不变）')
  } else {
    await templateStore.createTemplate(payload)
    ElMessage.success('模板已新建')
  }
  emit('saved')
  dialogVisible.value = false
}
</script>

<template>
  <el-dialog :model-value="visible" :title="isEdit ? '编辑工序模板' : '新建工序模板'" width="720px" @update:model-value="emit('update:visible', $event)">
    <el-form :model="form" label-width="92px">
      <el-form-item label="模板名称" required>
        <el-input v-model="form.name" placeholder="如：中重度彩画修复链" maxlength="30" show-word-limit />
      </el-form-item>
      <el-form-item label="适用程度">
        <el-checkbox-group v-model="form.severities">
          <el-checkbox v-for="item in SEVERITIES" :key="item" :value="item">{{ item }}</el-checkbox>
        </el-checkbox-group>
        <p class="muted form-hint">不勾选任何程度表示不限程度，殿宇下所有待编排病害都会命中。</p>
      </el-form-item>
      <el-form-item label="工序顺序" required>
        <div class="steps-editor">
          <div v-for="(step, index) in form.steps" :key="index" class="steps-editor__row">
            <span class="steps-editor__seq">{{ index + 1 }}</span>
            <el-select v-model="step.name" class="steps-editor__name">
              <el-option v-for="item in REPAIR_STEP_NAMES" :key="item" :label="item" :value="item" />
            </el-select>
            <el-input
              v-model="step.material"
              class="steps-editor__material"
              placeholder="默认材料 / 配比，如：鱼鳔胶（2% 明矾水调和）"
              maxlength="60"
            />
            <el-button-group>
              <el-button :icon="ArrowUp" :disabled="index === 0" title="上移" @click="moveStep(index, -1)" />
              <el-button
                :icon="ArrowDown"
                :disabled="index === form.steps.length - 1"
                title="下移"
                @click="moveStep(index, 1)"
              />
              <el-button :icon="Delete" :disabled="form.steps.length === 1" title="删除" @click="removeStep(index)" />
            </el-button-group>
          </div>
          <el-button :icon="Plus" plain size="small" @click="addStep">追加一道工序</el-button>
        </div>
      </el-form-item>
    </el-form>
    <p class="muted form-hint">
      批量生成时以保存后的模板内容为准一次性写入；之后再修改模板，已经生成的历史工序不会被重写。
    </p>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="submit">保存模板</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form-hint {
  margin: 4px 0 0;
  font-size: 12px;
}

.steps-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.steps-editor__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.steps-editor__seq {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  border-radius: 50%;
  background: #8a5a2b;
  color: #fff;
  font-size: 12px;
}

.steps-editor__name {
  width: 110px;
  flex: 0 0 110px;
}

.steps-editor__material {
  flex: 1 1 auto;
  min-width: 160px;
}
</style>
