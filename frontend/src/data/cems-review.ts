import { appendAudit } from './audit-log'
import type { CemsReviewItem } from './types'

// 烟气净化出口温度越限的判定结果同步到这里；核实前是「待核」，核实后留核实人、时间与意见。
const REVIEW_KEY = 'waste-to-energy-plant:cems-review'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readItems(): CemsReviewItem[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(REVIEW_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CemsReviewItem[]) : []
  } catch {
    return []
  }
}

let cache: CemsReviewItem[] | null = null

function items(): CemsReviewItem[] {
  if (cache === null) {
    cache = readItems()
  }
  return cache
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(REVIEW_KEY, JSON.stringify(items()))
  }
}

function nextId(list: CemsReviewItem[]): number {
  return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
}

export type CemsReviewDraft = {
  净化编号: string
  监测因子: string
  实测值: string
  排放限值: string
  判定结果: string
  发生时间: string
}

// 同步一条待核项：同一条净化记录已有「待核」项时不重复挂，避免待核清单被同一条越限刷爆。
export function pushReviewItem(draft: CemsReviewDraft): CemsReviewItem {
  const list = items()
  const existing = list.find(
    (item) => item.净化编号 === draft.净化编号 && item.status === '待核',
  )
  if (existing) {
    return existing
  }
  const item: CemsReviewItem = {
    id: nextId(list),
    status: '待核',
    source: '烟气净化联动',
    净化编号: draft.净化编号,
    监测因子: draft.监测因子,
    实测值: draft.实测值,
    排放限值: draft.排放限值,
    判定结果: draft.判定结果,
    发生时间: draft.发生时间,
    核实人员: '',
    核实时间: '',
    核实意见: '',
  }
  const next = [...list, item]
  cache = next
  persist()
  return item
}

export function listReviewItems(includeDone = false): CemsReviewItem[] {
  const list = clone(items())
  const filtered = includeDone ? list : list.filter((item) => item.status === '待核')
  return filtered.sort((a, b) => (a.发生时间 < b.发生时间 ? 1 : a.发生时间 > b.发生时间 ? -1 : b.id - a.id))
}

export function acknowledgeReview(
  id: number,
  operator: string,
  note: string,
  timeText: string,
): CemsReviewItem | null {
  const list = items()
  const index = list.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return null
  }
  const updated: CemsReviewItem = {
    ...list[index],
    status: '已核实',
    核实人员: operator,
    核实时间: timeText,
    核实意见: note,
  }
  const next = [...list]
  next[index] = updated
  cache = next
  persist()
  appendAudit({
    operator,
    module: 'cems',
    净化编号: updated.净化编号,
    action: '核实在线监测待核项',
    fromStatus: '待核',
    toStatus: '已核实',
    detail: `${updated.监测因子}：${updated.判定结果}（实测 ${updated.实测值}，限值 ${updated.排放限值}）`,
    note,
  })
  return updated
}

export function reviewStorageKey(): string {
  return REVIEW_KEY
}
