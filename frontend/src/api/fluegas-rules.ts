import { appendAudit, nowText } from '@/data/audit-store'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow, ModuleRules } from '@/data/types'

// 出口烟气温度限值（℃）：超过即判定指标异常，并联动在线排放监测待核清单。
export const OUTLET_TEMP_LIMIT = 180

const MODULE_KEY = 'fluegas'
// 投运前必须补齐的格子，缺哪一格退回时要点名。
const COMMISSION_REQUIRED_FIELDS = ['反应塔温度', '活性炭喷射量']
// 「在跑」= 还没停运的记录：运行中 + 指标异常。
const ACTIVE_STATUSES = ['运行中', '指标异常']

function outletTemp(row: EntryRow): number | null {
  const raw = String(row['出口烟气温度'] ?? '').trim()
  if (raw === '') {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function isOutletBreached(row: EntryRow): boolean {
  const temp = outletTemp(row)
  return temp !== null && temp > OUTLET_TEMP_LIMIT
}

function missingCommissionFields(row: EntryRow): string[] {
  return COMMISSION_REQUIRED_FIELDS.filter((field) => String(row[field] ?? '').trim() === '')
}

function findActiveSibling(row: EntryRow, rows: EntryRow[]): EntryRow | undefined {
  const code = String(row['净化编号'] ?? '').trim()
  if (code === '') {
    return undefined
  }
  return rows.find(
    (item) =>
      Number(item.id) !== Number(row.id) &&
      String(item['净化编号'] ?? '').trim() === code &&
      ACTIVE_STATUSES.includes(String(item.status)),
  )
}

/** 把判定结果写进在线排放监测的待核清单（待采集、pending）。 */
function syncBreachToCems(row: EntryRow, temp: number | null): void {
  const rows = listRows('cems')
  const nextId = rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const record: EntryRow = {
    id: nextId,
    status: '待采集',
    pending: true,
    abnormal: false,
    监测编号: `CEMS-${String(nextId).padStart(4, '0')}`,
    监测因子: '出口烟气温度',
    实测值: temp === null ? '' : String(temp),
    排放限值: String(OUTLET_TEMP_LIMIT),
    折算值: '',
    采集时间: nowText(),
    审核人员: '',
    监测状态: `烟气净化${String(row['净化编号'] ?? '')}超限联动`,
  }
  saveRows('cems', [...rows, record])
}

/** 出口烟气温度超限：自动切到指标异常 + 留痕 + 联动在线排放监测待核清单。 */
function markAbnormal(id: number, operator: string): string {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return ''
  }
  const current = rows[index]
  if (String(current.status) === '指标异常') {
    return ''
  }
  const temp = outletTemp(current)
  const next = [...rows]
  next[index] = { ...current, status: '指标异常', pending: true, abnormal: true }
  saveRows(MODULE_KEY, next)
  appendAudit(MODULE_KEY, id, {
    time: nowText(),
    operator,
    action: '自动判定',
    detail: `出口烟气温度${temp}℃超过限值${OUTLET_TEMP_LIMIT}℃，状态由「${current.status}」切到「指标异常」`,
  })
  syncBreachToCems(next[index], temp)
  return `出口烟气温度${temp}℃超过限值${OUTLET_TEMP_LIMIT}℃，已自动切到「指标异常」并同步在线排放监测待核清单`
}

export const fluegasRules: ModuleRules = {
  guard(action, row, rows) {
    if (action !== '提交投运') {
      return null
    }
    const code = String(row['净化编号'] ?? '').trim() || '该记录'
    const missing = missingCommissionFields(row)
    if (missing.length > 0) {
      return `投运被退回：${code}缺少${missing.map((field) => `「${field}」`).join('、')}，补齐后再提交投运`
    }
    const sibling = findActiveSibling(row, rows)
    if (sibling) {
      return `投运被退回：净化编号${code}已有一条在跑记录（#${sibling.id}，${sibling.status}），同一条净化编号只留一条在跑的记录`
    }
    return null
  },

  afterTransition(action, id, operator, fromStatus) {
    const row = listRows(MODULE_KEY).find((item) => Number(item.id) === id)
    if (!row) {
      return ''
    }
    appendAudit(MODULE_KEY, id, {
      time: nowText(),
      operator,
      action,
      detail: `状态由「${fromStatus}」变为「${row.status}」`,
    })
    // 投运或处理恢复后仍超限的，立刻自动判回指标异常。
    if (String(row.status) === '运行中' && isOutletBreached(row)) {
      return markAbnormal(id, operator)
    }
    return ''
  },

  afterUpdate(id, changes, operator) {
    appendAudit(MODULE_KEY, id, {
      time: nowText(),
      operator,
      action: '修改数据',
      detail: changes.join('；'),
    })
    const row = listRows(MODULE_KEY).find((item) => Number(item.id) === id)
    if (row && String(row.status) === '运行中' && isOutletBreached(row)) {
      return markAbnormal(id, operator)
    }
    return ''
  },

  sweep() {
    for (const row of listRows(MODULE_KEY)) {
      if (String(row.status) === '运行中' && isOutletBreached(row)) {
        markAbnormal(Number(row.id), '系统自动')
      }
    }
  },
}
