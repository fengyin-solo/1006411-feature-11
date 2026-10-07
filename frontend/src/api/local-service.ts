import { fluegasRules } from '@/api/fluegas-rules'
import { listAudit } from '@/data/audit-store'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  AuditEntry,
  EntryRow,
  ModuleMeta,
  ModuleRules,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 模块级业务规则：状态机之外的校验、联动、留痕都挂在这里，页面不碰业务判断。
const MODULE_RULES: Record<string, ModuleRules> = {
  fluegas: fluegasRules,
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  MODULE_RULES[key]?.sweep?.()
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 这条记录当前允许执行哪些动作：按模块登记的状态机过滤。 */
export function availableActions(key: string, row: EntryRow): string[] {
  const meta = moduleMeta(key)
  const current = String(row.status)
  return meta.actions.filter((action) => {
    const allowedFrom = meta.actionFrom?.[action]
    return !allowedFrom || allowedFrom.includes(current)
  })
}

export function runAction(
  key: string,
  id: number,
  action: string,
  operator = '值班管理员',
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rules = MODULE_RULES[key]
  rules?.sweep?.()
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const allowedFrom = meta.actionFrom?.[action]
  if (allowedFrom && !allowedFrom.includes(current)) {
    return {
      ok: false,
      message: `${meta.entity}当前状态是「${current}」，「${action}」只能从${allowedFrom
        .map((status) => `「${status}」`)
        .join('、')}发起`,
    }
  }
  const rejected = rules?.guard?.(action, rows[index], rows)
  if (rejected) {
    return { ok: false, message: rejected }
  }
  const terminal = meta.terminalStatuses ?? [meta.statuses[meta.statuses.length - 1]]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !terminal.includes(target),
    abnormal: meta.abnormalStatuses
      ? meta.abnormalStatuses.includes(target)
      : NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  const note = rules?.afterTransition?.(action, id, operator, current) ?? ''
  const finalStatus = String(listRows(key).find((row) => Number(row.id) === id)?.status ?? target)
  return {
    ok: true,
    message: `${meta.entity}已${action}，当前状态「${finalStatus}」${note ? `。${note}` : ''}`,
  }
}

/** 修改记录字段：逐格比对落库，改了哪几格都会交给模块规则留痕。 */
export function updateEntry(
  key: string,
  id: number,
  changes: Record<string, string>,
  operator = '值班管理员',
): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const updated: EntryRow = { ...rows[index] }
  const applied: string[] = []
  for (const [field, value] of Object.entries(changes)) {
    if (!meta.fields.includes(field)) {
      return { ok: false, message: `${meta.entity}没有「${field}」这个字段，不能改` }
    }
    const before = String(updated[field] ?? '')
    if (before === value) {
      continue
    }
    updated[field] = value
    applied.push(`${field}由「${before || '空'}」改为「${value || '空'}」`)
  }
  if (applied.length === 0) {
    return { ok: false, message: '没有改动，不用保存' }
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  const note = MODULE_RULES[key]?.afterUpdate?.(id, applied, operator) ?? ''
  return {
    ok: true,
    message: `${meta.entity}已更新：${applied.join('；')}${note ? `。${note}` : ''}`,
  }
}

/** 一条记录的处置留痕：谁、什么时候、做了什么，按时间顺序倒查。 */
export function listEntryAudit(key: string, id: number): AuditEntry[] {
  return listAudit(key, id)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  for (const key of MODULE_BY_KEY.keys()) {
    MODULE_RULES[key]?.sweep?.()
  }
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
