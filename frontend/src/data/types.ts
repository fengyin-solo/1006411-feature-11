/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  /** 可选：每个动作允许从哪些状态发起。不登记时保持旧的自由流转。 */
  actionFrom?: Record<string, string[]>
  /** 可选：终态清单，进入这些状态后 pending 记为 false。缺省取状态列表最后一项。 */
  terminalStatuses?: string[]
  /** 可选：异常态清单，进入这些状态后 abnormal 记为 true。缺省按动作名里的负面词判断。 */
  abnormalStatuses?: string[]
  metrics: string[]
}

/** 一条处置留痕：谁、什么时候、对这条记录做了什么。 */
export type AuditEntry = {
  time: string
  operator: string
  action: string
  detail: string
}

/** 模块级业务规则钩子：local-service 在流转、改数、读取时按模块回调。 */
export type ModuleRules = {
  /** 动作发起前校验，返回驳回原因；返回 null 表示放行。 */
  guard?: (action: string, row: EntryRow, rows: EntryRow[]) => string | null
  /** 状态流转落库后回调（可继续改数、联动其他模块），返回追加到结果里的说明。 */
  afterTransition?: (action: string, id: number, operator: string, fromStatus: string) => string
  /** 字段修改落库后回调，返回追加到结果里的说明。 */
  afterUpdate?: (id: number, changes: string[], operator: string) => string
  /** 列表读取前的自动巡检（例如超限自动切状态）。 */
  sweep?: () => void
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
