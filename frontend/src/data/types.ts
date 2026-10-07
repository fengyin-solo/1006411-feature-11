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
  metrics: string[]
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

// 烟气净化处置留痕：状态流转、石灰浆流量异常处置、出口温度自动判定都追加一条，谁、什么时候、改了什么可倒查。
export type AuditEntry = {
  id: number
  time: string
  operator: string
  module: string
  净化编号: string
  action: string
  fromStatus: string
  toStatus: string
  detail: string
  note: string
}

// 在线排放监测的联动待核项：烟气净化出口温度越限自动判定后，结果同步到这里等监测人员核实。
export type CemsReviewItem = {
  id: number
  status: string
  source: string
  净化编号: string
  监测因子: string
  实测值: string
  排放限值: string
  判定结果: string
  发生时间: string
  核实人员: string
  核实时间: string
  核实意见: string
}
