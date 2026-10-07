import type { AuditEntry } from './types'

// 处置留痕单独存一份 localStorage：和业务数据分开，重置业务数据不会丢操作痕迹。
const AUDIT_KEY = 'waste-to-energy-plant:audit'

function readAll(): Record<string, AuditEntry[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return memoryFallback
  }
  const raw = window.localStorage.getItem(AUDIT_KEY)
  if (!raw) {
    return {}
  }
  try {
    return JSON.parse(raw) as Record<string, AuditEntry[]>
  } catch {
    return {}
  }
}

function writeAll(data: Record<string, AuditEntry[]>): void {
  memoryFallback = data
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(data))
  }
}

// 非浏览器环境（比如脚本自测）下退化成内存存储。
let memoryFallback: Record<string, AuditEntry[]> = {}

function slot(moduleKey: string, id: number): string {
  return `${moduleKey}:${id}`
}

export function listAudit(moduleKey: string, id: number): AuditEntry[] {
  return readAll()[slot(moduleKey, id)] ?? []
}

export function appendAudit(moduleKey: string, id: number, entry: AuditEntry): void {
  const all = readAll()
  const key = slot(moduleKey, id)
  all[key] = [...(all[key] ?? []), entry]
  writeAll(all)
}

export function nowText(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}
