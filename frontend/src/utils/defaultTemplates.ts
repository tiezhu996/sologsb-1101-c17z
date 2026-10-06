import type { RepairTemplate } from '@/types/repairTemplate'

/**
 * 内置修复工序模板：首次建库与 v2 → v3 升级时播种。
 * 固定 id 便于升级时去重；可编辑、可停用，但不允许删除（只能停用）。
 */
export function buildDefaultTemplates(now: number = Date.now()): RepairTemplate[] {
  return [
    {
      id: 'tpl_builtin_light',
      name: '轻度病害常规养护',
      steps: [
        { name: '除尘', material: '软毛刷 + 去离子水' },
        { name: '封护', material: '3% B72 丙酮溶液' }
      ],
      severities: ['轻度'],
      active: true,
      builtin: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'tpl_builtin_midheavy',
      name: '中重度彩画修复链',
      steps: [
        { name: '除尘', material: '软毛刷 + 去离子水' },
        { name: '回贴', material: '鱼鳔胶（2% 明矾水调和）' },
        { name: '补绘', material: '矿物颜料 + 桃胶' },
        { name: '封护', material: '3% B72 丙酮溶液' }
      ],
      severities: ['中度', '重度'],
      active: true,
      builtin: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'tpl_builtin_grouting',
      name: '空鼓灌浆专项',
      steps: [
        { name: '除尘', material: '洗耳球 + 软毛刷' },
        { name: '灌浆', material: '氢氧化钙悬浮液' },
        { name: '回贴', material: '鱼鳔胶（2% 明矾水调和）' },
        { name: '封护', material: '3% B72 丙酮溶液' }
      ],
      severities: ['中度', '重度'],
      active: true,
      builtin: true,
      createdAt: now,
      updatedAt: now
    }
  ]
}
