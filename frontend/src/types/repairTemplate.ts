import type { Severity } from '@/types/decay'
import type { RepairStepName } from '@/types/repair'

/**
 * 修复工序模板：可维护的批量生成模板。
 * 生成工序时以模板「当时内容」为准并写入快照来源，
 * 之后修改 / 停用模板均不影响已经生成的历史工序。
 */
export interface RepairTemplate {
  id: string
  /** 模板名称，同一时刻启用模板之间不可重名 */
  name: string
  /** 工序先后顺序，数组顺序即生成后的 seq（从 1 开始） */
  steps: RepairTemplateStep[]
  /** 适用病害程度：命中其一即可套用，空数组表示不做程度限制 */
  severities: Severity[]
  /** 停用后不能再被选择用于生成，历史工序仍可凭来源快照识别 */
  active: boolean
  /** 内置模板标记：随数据库初始化写入，可编辑可停用，不允许删除 */
  builtin: boolean
  createdAt: number
  updatedAt: number
}

/** 模板中的一道工序及其默认材料 */
export interface RepairTemplateStep {
  name: RepairStepName
  /** 默认材料 / 配比，生成时直接带入，可在工序时间线再调整 */
  material: string
}

/** 按殿宇预览时命中的一条病害（附带层位 / 构件信息） */
export interface TemplatePreviewDecay {
  decayId: string
  type: import('@/types/decay').DecayType
  severity: Severity
  areaCm2: number
  layerPattern: string
  layerPigment: string
  elementName: string
}

/** 模板 × 殿宇的预览结果：确认后按此写入 */
export interface TemplatePreview {
  templateId: string
  hallId: string
  hits: TemplatePreviewDecay[]
  /** 命中病害数（已有工序的病害不参与，不计入） */
  hitCount: number
  /** 每道病害生成的工序数，即模板工序链长度 */
  stepsPerDecay: number
  /** 预计写入工序总数 = hitCount × stepsPerDecay */
  totalStepCount: number
}
