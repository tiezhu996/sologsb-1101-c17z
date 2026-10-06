/** 修复工序：针对某条病害记录的施工步骤 */
import type { Severity } from './decay'

export type RepairStepName = '除尘' | '回贴' | '灌浆' | '补绘' | '封护'
export type RepairState = '未开始' | '进行中' | '已完成'

export interface RepairStep {
  id: string
  decayId: string
  /** 工序先后序号，从 1 开始 */
  seq: number
  name: RepairStepName
  material: string
  operator: string
  state: RepairState
  /** 由工序模板生成时记录的来源模板；手填工序与历史工序为 null */
  templateId: string | null
  /** 生成当时模板名称的快照：模板停用/删除/改名后仍可识别来源 */
  templateName: string | null
  createdAt: number
  updatedAt: number
}

export const REPAIR_STEP_NAMES: RepairStepName[] = ['除尘', '回贴', '灌浆', '补绘', '封护']
export const REPAIR_STATES: RepairState[] = ['未开始', '进行中', '已完成']

/** 模板中的一道工序（顺序即数组顺序） */
export interface RepairTemplateStep {
  /** 模板内稳定标识，供编辑器 v-for key 使用 */
  key: string
  name: RepairStepName
  /** 默认材料 / 配比，生成时带入工序，可留空 */
  material: string
}

/** 工序模板：按病害程度批量生成一组有序工序 */
export interface RepairTemplate {
  id: string
  name: string
  /** 适用病害程度：病害 severity 命中其一才会按本模板生成 */
  severities: Severity[]
  /** 工序顺序（数组顺序即施工先后） */
  steps: RepairTemplateStep[]
  /** 停用后不可再选；历史已生成工序与备份仍可识别 */
  active: boolean
  remark: string
  /** 是否为随库初始化的内置模板 */
  builtin: boolean
  createdAt: number
  updatedAt: number
}

/** 新建 / 编辑模板的表单草稿 */
export type RepairTemplateDraft = Pick<RepairTemplate, 'name' | 'severities' | 'remark'> & {
  steps: RepairTemplateStep[]
}

export const REPAIR_TEMPLATE_NAME_MAX = 30
export const REPAIR_TEMPLATE_REMARK_MAX = 80
export const REPAIR_TEMPLATE_STEP_MATERIAL_MAX = 60

/** 工序按病害归组后的时间线节点 */
export interface RepairGroup {
  decayId: string
  decay: import('./decay').Decay | null
  layer: import('./layer').PaintLayer | null
  element: import('./element').Element | null
  hall: import('./hall').Hall | null
  steps: RepairStep[]
  doneCount: number
  totalCount: number
  percent: number
}
