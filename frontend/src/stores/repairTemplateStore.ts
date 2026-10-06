import { defineStore } from 'pinia'
import { computed } from 'vue'
import { db } from '@/utils/db'
import { useIdbTable } from '@/hooks/useIdbTable'
import { useDecayStore } from '@/stores/decayStore'
import { useHallStore } from '@/stores/hallStore'
import { useRepairStore } from '@/stores/repairStore'
import type { Decay } from '@/types/decay'
import type { Element } from '@/types/element'
import type { PaintLayer } from '@/types/layer'
import type { RepairStep, RepairStepName } from '@/types/repair'
import type {
  RepairTemplate,
  RepairTemplateStep,
  TemplatePreview,
  TemplatePreviewDecay
} from '@/types/repairTemplate'

export interface SaveTemplateInput {
  name: string
  steps: RepairTemplateStep[]
  severities: RepairTemplate['severities']
}

/** 模板保存前的表单校验，返回错误信息（为空表示通过） */
export function validateTemplateForm(
  form: SaveTemplateInput,
  templates: RepairTemplate[],
  excludeId?: string
): string | null {
  const name = form.name.trim()
  if (name.length === 0) return '模板名称不能为空'
  if (name.length > 30) return '模板名称不能超过 30 个字'
  const duplicated = templates.some(
    (template) => template.active && template.name.trim() === name && template.id !== excludeId
  )
  if (duplicated) return `已存在同名启用模板「${name}」`
  if (form.steps.length === 0) return '至少保留一道工序'
  if (form.steps.some((step) => step.material.trim().length > 60)) return '单条默认材料不能超过 60 个字'
  return null
}

/**
 * 工序模板 store：模板的增改停删，以及「按殿宇预览命中 → 确认生成」。
 * 生成时对模板内容做一次性快照，模板之后的任何改动都不会重写历史工序。
 */
export const useRepairTemplateStore = defineStore('repairTemplate', () => {
  const templateTable = useIdbTable<RepairTemplate>((database) => database.repairTemplates)
  const decayStore = useDecayStore()
  const hallStore = useHallStore()
  // Pinia setup store 在函数被调用时才取实例，可安全地与 repairStore 互相引用
  const getRepairStore = (): ReturnType<typeof useRepairStore> => useRepairStore()

  const templates = computed<RepairTemplate[]>(() =>
    [...templateTable.rows.value].sort((a, b) => b.createdAt - a.createdAt)
  )
  const activeTemplates = computed<RepairTemplate[]>(() =>
    templates.value.filter((template) => template.active)
  )

  function templateById(id: string): RepairTemplate | undefined {
    return templates.value.find((template) => template.id === id)
  }

  async function createTemplate(form: SaveTemplateInput): Promise<RepairTemplate> {
    return templateTable.create(
      {
        name: form.name.trim(),
        steps: form.steps.map((step) => ({ name: step.name, material: step.material.trim() })),
        severities: [...form.severities],
        active: true,
        builtin: false
      },
      'tpl'
    )
  }

  async function updateTemplate(id: string, form: SaveTemplateInput): Promise<void> {
    const current = templateById(id)
    if (!current) return
    await templateTable.update(id, {
      name: form.name.trim(),
      steps: form.steps.map((step) => ({ name: step.name, material: step.material.trim() })),
      severities: [...form.severities],
      // active 不在编辑表单内：原状态原样保留
      active: current.active
    })
  }

  async function setActive(id: string, active: boolean): Promise<void> {
    await templateTable.update(id, { active })
  }

  /** 内置模板不允许删除；自定义模板可删（历史工序靠自身快照仍可识别） */
  async function removeTemplate(id: string): Promise<void> {
    const current = templateById(id)
    if (!current || current.builtin) return
    await templateTable.remove(id)
  }

  /** 该殿宇下尚无任何工序、且程度被模板适用范围覆盖的病害 */
  function matchDecays(template: RepairTemplate, hallId: string): Decay[] {
    const hallDecays = hallStore.decaysByHall[hallId] ?? []
    const occupiedDecayIds = new Set(getRepairStore().steps.map((step) => step.decayId))
    return hallDecays
      .filter((decay) => !occupiedDecayIds.has(decay.id))
      .filter((decay) => template.severities.length === 0 || template.severities.includes(decay.severity))
      .sort((a, b) => {
        const weight = (severity: Decay['severity']): number =>
          severity === '重度' ? 3 : severity === '中度' ? 2 : 1
        const diff = weight(b.severity) - weight(a.severity)
        if (diff !== 0) return diff
        return b.areaCm2 - a.areaCm2
      })
  }

  /** 无命中时的原因说明；有命中返回 null */
  function noMatchReason(template: RepairTemplate, hallId: string): string | null {
    const hall = hallStore.hallById(hallId)
    if (!hall) return '所选殿宇不存在'
    const hallDecays = hallStore.decaysByHall[hallId] ?? []
    if (hallDecays.length === 0) return `殿宇「${hall.name}」下还没有病害记录`
    const occupiedDecayIds = new Set(getRepairStore().steps.map((step) => step.decayId))
    const withoutSteps = hallDecays.filter((decay) => !occupiedDecayIds.has(decay.id))
    if (withoutSteps.length === 0) return `殿宇「${hall.name}」的病害都已有工序（已有工序不参与生成）`
    if (template.severities.length === 0) return null
    const matched = withoutSteps.filter((decay) => template.severities.includes(decay.severity))
    if (matched.length === 0) {
      const present = Array.from(new Set(withoutSteps.map((decay) => decay.severity))).join('、')
      return `殿宇「${hall.name}」待编排病害的程度为 ${present}，不在模板「${template.name}」的适用范围（${template.severities.join(
        '、'
      )}）内`
    }
    return null
  }

  /** 组装预览：命中哪些病害、将生成多少道工序 */
  function preview(template: RepairTemplate, hallId: string): TemplatePreview {
    const layerMap = new Map<string, PaintLayer>()
    decayStore.layers.forEach((layer) => layerMap.set(layer.id, layer))
    const elementMap = new Map<string, Element>()
    decayStore.elements.forEach((element) => elementMap.set(element.id, element))

    const hits: TemplatePreviewDecay[] = matchDecays(template, hallId).map((decay) => {
      const layer = layerMap.get(decay.layerId) ?? null
      const element = layer ? elementMap.get(layer.elementId) ?? null : null
      return {
        decayId: decay.id,
        type: decay.type,
        severity: decay.severity,
        areaCm2: decay.areaCm2,
        layerPattern: layer?.patternName ?? '层位已删除',
        layerPigment: layer?.pigment ?? '',
        elementName: element?.name ?? '构件已删除'
      }
    })

    return {
      templateId: template.id,
      hallId,
      hits,
      hitCount: hits.length,
      stepsPerDecay: template.steps.length,
      totalStepCount: hits.length * template.steps.length
    }
  }

  /**
   * 按模板当时内容写入工序。已有工序的病害不参与：
   * 生成内容以「模板当时内容」为准，之后改模板不会回写这些工序。
   * 返回实际写入的工序条数；无命中时不写任何数据。
   */
  async function applyTemplate(template: RepairTemplate, hallId: string): Promise<number> {
    const targets = matchDecays(template, hallId)
    if (targets.length === 0) return 0

    // 快照模板当时的名称与工序链，后续修改模板与历史工序彻底解耦
    const snapshotName = template.name
    const snapshotSteps: RepairTemplateStep[] = template.steps.map((step) => ({
      name: step.name,
      material: step.material
    }))

    const now = Date.now()
    const records: RepairStep[] = []
    targets.forEach((decay) => {
      snapshotSteps.forEach((step, index) => {
        records.push({
          id: `step_${decay.id}_${index}_${Math.random().toString(36).slice(2, 8)}`,
          decayId: decay.id,
          seq: index + 1,
          name: step.name as RepairStepName,
          material: step.material,
          operator: '',
          state: '未开始',
          templateId: template.id,
          templateName: snapshotName,
          createdAt: now,
          updatedAt: now
        })
      })
    })

    await db.transaction('rw', db.repairSteps, async () => {
      // 二次校验：预览确认与写入之间若已手工补了工序，跳过这些病害，绝不叠加
      const existing = await db.repairSteps
        .where('decayId')
        .anyOf(targets.map((decay) => decay.id))
        .toArray()
      const occupied = new Set(existing.map((step) => step.decayId))
      const writable = records.filter((record) => !occupied.has(record.decayId))
      if (writable.length > 0) await db.repairSteps.bulkPut(writable)
    })
    return records.length
  }

  return {
    templates,
    activeTemplates,
    templateById,
    createTemplate,
    updateTemplate,
    setActive,
    removeTemplate,
    noMatchReason,
    preview,
    applyTemplate,
    matchDecays
  }
})
