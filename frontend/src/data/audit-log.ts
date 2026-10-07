import type { AuditEntry } from './types'

// 处置留痕单独存一份：与业务数据分开，业务数据重置不影响留痕，追加写入、永不覆盖，方便倒查。
const AUDIT_KEY = 'waste-to-energy-plant:fluegas-audit'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readAudit(): AuditEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(AUDIT_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as AuditEntry[]) : []
  } catch {
    return []
  }
}

let cache: AuditEntry[] | null = null

function entries(): AuditEntry[] {
  if (cache === null) {
    cache = readAudit()
  }
  return cache
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(entries()))
  }
}

export function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

export type AuditDraft = {
  operator: string
  module?: string
  净化编号: string
  action: string
  fromStatus: string
  toStatus: string
  detail?: string
  note?: string
}

// 追加一条留痕。审计记录不允许修改、删除，只能往后加。
export function appendAudit(draft: AuditDraft): AuditEntry {
  const list = entries()
  const entry: AuditEntry = {
    id: list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
    time: nowText(),
    operator: draft.operator || '未登记操作人',
    module: draft.module ?? 'fluegas',
    净化编号: draft.净化编号,
    action: draft.action,
    fromStatus: draft.fromStatus,
    toStatus: draft.toStatus,
    detail: draft.detail ?? '',
    note: draft.note ?? '',
  }
  const next = [...list, entry]
  cache = next
  persist()
  return entry
}

export function listAudit(净化编号?: string): AuditEntry[] {
  const list = clone(entries())
  const sorted = list.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : b.id - a.id))
  if (!净化编号) {
    return sorted
  }
  return sorted.filter((item) => item.净化编号 === 净化编号)
}

export function exportAuditCsv(净化编号?: string): { filename: string; content: string } {
  const header = ['留痕编号', '操作时间', '操作人员', '净化编号', '动作', '变更前状态', '变更后状态', '处置内容', '备注']
  const lines = [header.join(',')]
  for (const row of listAudit(净化编号)) {
    lines.push(
      [
        row.id,
        row.time,
        row.operator,
        row.净化编号,
        row.action,
        row.fromStatus,
        row.toStatus,
        row.detail,
        row.note,
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(','),
    )
  }
  const suffix = 净化编号 ? `-${净化编号}` : ''
  return { filename: `烟气净化处置留痕${suffix}.csv`, content: `﻿${lines.join('\n')}` }
}

export function auditStorageKey(): string {
  return AUDIT_KEY
}
