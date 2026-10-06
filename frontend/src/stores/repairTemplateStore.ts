import { defineStore } from 'pinia'
import { computed } from 'vue'
import { db } from '@/utils/db'
import { useIdbTable } from '@/hooks/useIdbTable'
import { useDecayStore } from '@/stores/decayStore'
import { useRepairStore } from '@/stores/repairStore'
import { DEFAULT_REPAIR_TEMPLATES } from '@/utils/repairTemplateSeed'
import type { Decay, Severity } from '@/types/decay'
import type {
  RepairStep,
  RepairTemplate,
  RepairTemplateDraft,
  RepairTemplateStep
} from '@/types/repair'

/** 未命中的病害及原因（仅用于预览说明，不参与写入） */
export interface TemplateMiss {
  decay: Decay
  hallName: string
  location: string
  reason: '已有工序' | '程度不符'
}

/** 模板在某殿宇下的命中预览结果 */
export interface TemplatePreview {
  templateId: string
  /** 命中的病害：尚无工序且程度适用 */
  hits: Decay[]
  /** 每条命中病害生成的工序数（即模板工序条数） */
  stepsPerDecay: number
  /** 将写入的工序总数 */
  stepCount: number
  /** 未命中的病害明细，用于在预览中说明 */
  misses: TemplateMiss[]
  /** 未命中原因汇总计数 */
  missCounts: { hasSteps: number; severityMismatch: number }
  severityCounts: Record<Severity, number>
}

/** 生成结果：命中为 0 时不会产生任何写入 */
export interface TemplateGenerateResult {
  generated: boolean
  decayCount: number
  stepCount: number
}

/**
 * 工序模板 store：模板的增删改、停用，以及「按殿宇预览命中 → 确认后生成」。
 * 生成时只写入新工序，已有工序不参与；工序保存模板当时的名称快照，
 * 之后修改/停用/删除模板均不会回写已生成的工序。
 */
export const useRepairTemplateStore = defineStore('repairTemplate', () => {
  const templatesTable = useIdbTable<RepairTemplate>((database) => database.repairTemplates)
  const decayStore = useDecayStore()
  const repairStore = useRepairStore()

  const templates = computed<RepairTemplate[]>(() => templatesTable.rows.value)
  const activeTemplates = computed(() => templates.value.filter((template) => template.active))

  function templateById(id: string): RepairTemplate | undefined {
    return templates.value.find((template) => template.id === id)
  }

  /** 空库（新装或清空后）补齐内置模板，幂等 */
  async function ensureDefaultTemplates(): Promise<void> {
    const count = await db.repairTemplates.count()
    if (count === 0) {
      await db.repairTemplates.bulkAdd(DEFAULT_REPAIR_TEMPLATES())
    }
  }

  async function createTemplate(draft: RepairTemplateDraft): Promise<RepairTemplate> {
    return templatesTable.create(
      {
        name: draft.name.trim(),
        severities: [...draft.severities],
        steps: draft.steps.map((step) => ({ key: step.key, name: step.name, material: step.material.trim() })),
        active: true,
        remark: draft.remark.trim(),
        builtin: false
      },
      'tpl'
    )
  }

  async function updateTemplate(id: string, draft: RepairTemplateDraft): Promise<void> {
    await templatesTable.update(id, {
      name: draft.name.trim(),
      severities: [...draft.severities],
      steps: draft.steps.map((step) => ({ key: step.key, name: step.name, material: step.material.trim() })),
      remark: draft.remark.trim()
    })
  }

  /** 停用：历史工序与备份保留来源快照，仅不能再被选择生成 */
  async function setActive(id: string, active: boolean): Promise<void> {
    await templatesTable.update(id, { active })
  }

  async function removeTemplate(id: string): Promise<void> {
    await templatesTable.remove(id)
  }

  /**
   * 预览模板在某殿宇下的命中情况，不做任何写入。
   * 作用范围为该殿宇全部病害：命中 = 尚无任何工序且程度在模板适用范围内。
   */
  function preview(templateId: string, hallId: string): TemplatePreview | null {
    const template = templateById(templateId)
    if (!template) return null

    const hits: Decay[] = []
    const misses: TemplateMiss[] = []
    const severityCounts: Record<Severity, number> = { 轻度: 0, 中度: 0, 重度: 0 }
    const existingDecayIds = new Set(repairStore.steps.map((step) => step.decayId))

    decayStore.rows
      .filter((row) => row.hallId === hallId)
      .forEach((row) => {
        const decay = row.decay
        if (existingDecayIds.has(decay.id)) {
          misses.push({
            decay,
            hallName: row.hallName || '',
            location: row.element?.name ?? '构件已删除',
            reason: '已有工序'
          })
          return
        }
        if (!template.severities.includes(decay.severity)) {
          misses.push({
            decay,
            hallName: row.hallName || '',
            location: row.element?.name ?? '构件已删除',
            reason: '程度不符'
          })
          return
        }
        hits.push(decay)
        severityCounts[decay.severity] += 1
      })

    const stepsPerDecay = template.steps.length
    return {
      templateId,
      hits,
      stepsPerDecay,
      stepCount: hits.length * stepsPerDecay,
      misses,
      missCounts: {
        hasSteps: misses.filter((item) => item.reason === '已有工序').length,
        severityMismatch: misses.filter((item) => item.reason === '程度不符').length
      },
      severityCounts
    }
  }

  /**
   * 确认生成：以模板「当时」内容为准（生成瞬间重新读取，避免编辑并发），
   * 仅为命中病害写入新工序；命中为 0 时不写任何数据。
   */
  async function generate(templateId: string, hallId: string): Promise<TemplateGenerateResult> {
    const liveTemplate = await db.repairTemplates.get(templateId)
    if (!liveTemplate || !liveTemplate.active) {
      return { generated: false, decayCount: 0, stepCount: 0 }
    }
    const result = preview(templateId, hallId)
    if (!result || result.hits.length === 0 || liveTemplate.steps.length === 0) {
      return { generated: false, decayCount: 0, stepCount: 0 }
    }

    const now = Date.now()
    const templateNameSnapshot = liveTemplate.name
    const records: RepairStep[] = []
    result.hits.forEach((decay) => {
      liveTemplate.steps.forEach((step: RepairTemplateStep, index: number) => {
        records.push({
          id: createStepId(decay.id, index),
          decayId: decay.id,
          seq: index + 1,
          name: step.name,
          material: step.material,
          operator: '',
          state: '未开始',
          templateId: liveTemplate.id,
          templateName: templateNameSnapshot,
          createdAt: now,
          updatedAt: now
        })
      })
    })
    await db.repairSteps.bulkPut(records)
    return { generated: true, decayCount: result.hits.length, stepCount: records.length }
  }

  /** 与旧 scaffold 保持同一风格的工序主键：病害 id + 序号 + 随机串 */
  function createStepId(decayId: string, index: number): string {
    return `${decayId}_${index}_${Math.random().toString(36).slice(2, 7)}`
  }

  return {
    templates,
    activeTemplates,
    templateById,
    ensureDefaultTemplates,
    createTemplate,
    updateTemplate,
    setActive,
    removeTemplate,
    preview,
    generate
  }
})
