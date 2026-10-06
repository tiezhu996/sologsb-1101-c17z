import {
  REPAIR_TEMPLATE_NAME_MAX,
  type RepairTemplate,
  type RepairTemplateDraft,
  type RepairTemplateStep
} from '@/types/repair'
import { SEVERITIES, type Severity } from '@/types/decay'

/** 生成模板内工序条目的稳定 key（仅用于编辑器） */
export function createStepKey(): string {
  return `tstep_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 内置工序模板：随 v3 升级或空库初始化写入，用户可停用/编辑/删除 */
export function DEFAULT_REPAIR_TEMPLATES(): RepairTemplate[] {
  const now = Date.now()
  const make = (
    idSuffix: string,
    name: string,
    severities: Severity[],
    steps: Array<[RepairTemplateStep['name'], string]>,
    remark: string
  ): RepairTemplate => ({
    id: `tpl_builtin_${idSuffix}`,
    name,
    severities,
    steps: steps.map(([stepName, material]) => ({ key: createStepKey(), name: stepName, material })),
    active: true,
    remark,
    builtin: true,
    createdAt: now,
    updatedAt: now
  })
  return [
    make(
      'light',
      '轻度病害常规工序',
      ['轻度'],
      [
        ['除尘', '软毛刷 + 去离子水'],
        ['封护', '3% B72 丙烯酸树脂溶液']
      ],
      '适用于粉化、轻微起甲：清洁表面后做封护加固。'
    ),
    make(
      'medium',
      '中度病害修复工序',
      ['中度'],
      [
        ['除尘', '软毛刷 + 去离子水'],
        ['回贴', '鱼鳔胶（2% 明矾水调和）'],
        ['补绘', '矿物颜料 + 桃胶'],
        ['封护', '3% B72 丙烯酸树脂溶液']
      ],
      '适用于起甲、龟裂、局部剥落：回贴后补绘并封护。'
    ),
    make(
      'heavy',
      '重度病害抢救工序',
      ['重度'],
      [
        ['除尘', '软毛刷 + 去离子水'],
        ['灌浆', '改性氢氧化钙浆液'],
        ['回贴', '鱼鳔胶（2% 明矾水调和）'],
        ['补绘', '矿物颜料 + 桃胶'],
        ['封护', '5% B72 丙烯酸树脂溶液']
      ],
      '适用于空鼓、大面积剥落：先灌浆加固，再回贴补绘封护。'
    )
  ]
}

/** 新建模板时的空白草稿 */
export function createEmptyTemplateDraft(): RepairTemplateDraft {
  return {
    name: '',
    severities: [...SEVERITIES],
    steps: [{ key: createStepKey(), name: '除尘', material: '' }],
    remark: ''
  }
}

/** 由既有模板生成编辑草稿（深拷贝工序数组，避免取消编辑时污染原记录） */
export function draftFromTemplate(template: RepairTemplate): RepairTemplateDraft {
  return {
    name: template.name,
    severities: [...template.severities],
    steps: template.steps.map((step) => ({ ...step })),
    remark: template.remark
  }
}

export interface TemplateDraftErrors {
  name?: string
  severities?: string
  steps?: string
}

/** 模板表单校验，错误信息以字段名索引 */
export function validateTemplateDraft(draft: RepairTemplateDraft, templates: RepairTemplate[], selfId?: string): TemplateDraftErrors {
  const errors: TemplateDraftErrors = {}
  const name = draft.name.trim()
  if (name.length === 0) {
    errors.name = '请填写模板名称'
  } else if (name.length > REPAIR_TEMPLATE_NAME_MAX) {
    errors.name = `名称不超过 ${REPAIR_TEMPLATE_NAME_MAX} 个字`
  } else if (templates.some((item) => item.name === name && item.id !== selfId)) {
    errors.name = '已存在同名模板，请换一个名称'
  }
  if (draft.severities.length === 0) errors.severities = '至少选择一种适用程度'
  if (draft.steps.length === 0) {
    errors.steps = '至少保留一道工序'
  } else if (draft.steps.some((step) => !step.name)) {
    errors.steps = '每道工序都需要选择名称'
  }
  return errors
}
