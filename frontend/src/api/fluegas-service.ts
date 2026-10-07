import { listRows, saveRows } from '@/data/local-store'
import { appendAudit, nowText } from '@/data/audit-log'
import { pushReviewItem } from '@/data/cems-review'
import type { ActionResult, EntryRow } from '@/data/types'

// 烟气净化状态线：待投运 → 运行中 → 已停运；运行中可挂「指标异常」，异常必须先「处理恢复」回运行中，才能停运归档。
export const FLUEGAS_STATUSES = ['待投运', '运行中', '已停运', '指标异常'] as const

// 出口烟气温度判定限值（℃）：运行中实测值超过它，系统直接把记录切成「指标异常」并同步在线排放监测待核清单。
export const OUTLET_TEMP_LIMIT = 180

// 每个动作只允许从哪几个状态发起；不在这里的状态一律拦住，杜绝一把从投运直接拖到停运。
const ALLOWED_FROM: Record<string, string[]> = {
  提交投运: ['待投运'],
  登记停运: ['运行中'],
  上报异常: ['运行中'],
  处理恢复: ['指标异常'],
}

const ACTIVE_STATUSES = ['运行中', '指标异常']

export type FluegasActionInput = {
  operator: string
  note?: string
  // 处理恢复时可回填调整后的石灰浆流量，留痕里记录旧值→新值。
  limeFlow?: string
  // 处理恢复时可回填处置后复测的出口烟气温度。
  outletTemp?: string
}

export type OutletAlert = {
  id: number
  净化编号: string
  value: number
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  const text = String(value ?? '').trim()
  if (text === '') {
    return null
  }
  const matched = text.match(/-?\d+(\.\d+)?/)
  if (!matched) {
    return null
  }
  const num = Number(matched[0])
  return Number.isFinite(num) ? num : null
}

function isFilled(value: unknown): boolean {
  return String(value ?? '').trim() !== ''
}

function snapshot(row: EntryRow): string {
  const parts = [
    `反应塔温度=${isFilled(row.反应塔温度) ? row.反应塔温度 : '未填'}`,
    `活性炭喷射量=${isFilled(row.活性炭喷射量) ? row.活性炭喷射量 : '未填'}`,
    `石灰浆流量=${isFilled(row.石灰浆流量) ? row.石灰浆流量 : '未填'}`,
    `出口烟气温度=${isFilled(row.出口烟气温度) ? row.出口烟气温度 : '未填'}`,
  ]
  return parts.join('；')
}

function persist(rows: EntryRow[]): void {
  saveRows('fluegas', rows)
}

function withFlags(row: EntryRow, status: string): EntryRow {
  return {
    ...row,
    status,
    pending: status !== '已停运',
    abnormal: status === '指标异常',
  }
}

function codeOf(row: EntryRow): string {
  return String(row.净化编号 ?? `#${row.id}`)
}

function writeTransition(
  row: EntryRow,
  action: string,
  toStatus: string,
  operator: string,
  detail: string,
  note: string,
): void {
  appendAudit({
    operator,
    module: 'fluegas',
    净化编号: codeOf(row),
    action,
    fromStatus: String(row.status),
    toStatus,
    detail,
    note,
  })
}

// 出口烟气温度越限自动判定：在任何列表读取/操作后先跑一遍，运行中超限的整批切「指标异常」。
// 已在异常态、待投运、已停运的不动；幂等，重复跑不会重复挂待核项。
export function evaluateOutletTemps(operator = '系统自动判定'): OutletAlert[] {
  const rows = listRows('fluegas')
  const alerts: OutletAlert[] = []
  let changed = false
  const next = rows.map((row) => {
    if (String(row.status) !== '运行中') {
      return row
    }
    const value = parseNumber(row.出口烟气温度)
    if (value === null || value <= OUTLET_TEMP_LIMIT) {
      return row
    }
    changed = true
    const updated = withFlags(row, '指标异常')
    alerts.push({ id: Number(row.id), 净化编号: codeOf(row), value })
    writeTransition(
      row,
      '出口温度越限自动判定',
      '指标异常',
      operator,
      `出口烟气温度实测 ${value}℃，超过限值 ${OUTLET_TEMP_LIMIT}℃，系统自动切为「指标异常」；${snapshot(row)}`,
      '判定结果已同步至在线排放监测待核清单',
    )
    pushReviewItem({
      净化编号: codeOf(row),
      监测因子: '出口烟气温度',
      实测值: `${value}℃`,
      排放限值: `≤${OUTLET_TEMP_LIMIT}℃`,
      判定结果: `出口烟气温度 ${value}℃ 超限值 ${OUTLET_TEMP_LIMIT}℃，已联动切为指标异常`,
      发生时间: nowText(),
    })
    return updated
  })
  if (changed) {
    persist(next)
  }
  return alerts
}

// 烟气净化专用状态流转：所有跨状态动作都从这里走，generic 的 runAction 不允许再直接改净化线状态。
export function transitionFluegas(
  id: number,
  action: string,
  input: FluegasActionInput,
): ActionResult {
  const allowed = ALLOWED_FROM[action]
  if (!allowed) {
    return { ok: false, message: `烟气净化记录没有登记「${action}」这个动作` }
  }
  const rows = listRows('fluegas')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的烟气净化记录` }
  }
  const row = rows[index]
  const current = String(row.status)
  const code = codeOf(row)
  const operator = input.operator || '未登记操作人'
  const note = (input.note ?? '').trim()

  if (!allowed.includes(current)) {
    return { ok: false, message: rejectMessage(action, current, code) }
  }

  // 投运前置：反应塔温度、活性炭喷射量缺一格都不行，退回时把缺的格名列出来。
  if (action === '提交投运') {
    const missing: string[] = []
    if (!isFilled(row.反应塔温度)) {
      missing.push('反应塔温度')
    }
    if (!isFilled(row.活性炭喷射量)) {
      missing.push('活性炭喷射量')
    }
    if (missing.length > 0) {
      return {
        ok: false,
        message: `净化编号 ${code} 不允许投运：缺少「${missing.join('」「')}」，请补录后再提交投运`,
      }
    }
    // 同一条净化编号只留一条在跑的记录：运行中或指标异常都算在跑。
    const duplicated = rows.find(
      (item) =>
        Number(item.id) !== Number(row.id) &&
        String(item.净化编号 ?? '').trim() === String(row.净化编号 ?? '').trim() &&
        ACTIVE_STATUSES.includes(String(item.status)),
    )
    if (duplicated) {
      return {
        ok: false,
        message: `净化编号 ${code} 已有在跑记录（#${duplicated.id}，当前「${duplicated.status}」），同一净化编号只允许一条在跑记录，请勿重复投运`,
      }
    }
  }

  // 石灰浆流量异常处置要留痕：上报异常必须写明异常现象/原因，恢复必须写处置过程。
  if (action === '上报异常' && note === '') {
    return { ok: false, message: `净化编号 ${code} 上报指标异常必须填写异常现象或原因（如石灰浆流量异常情况），处置过程要留痕` }
  }
  if (action === '处理恢复') {
    if (note === '') {
      return { ok: false, message: `净化编号 ${code} 恢复运行必须填写处置过程（含石灰浆流量异常的处理措施），处置过程要留痕` }
    }
    // 异常消缺才能回运行中：出口烟气温度还超限，说明指标没恢复，恢复了也会被自动判定打回，直接拦在前面。
    // 现场处置后会重新测温，允许在本次恢复里回填复测值。
    const newOutlet = input.outletTemp !== undefined && input.outletTemp.trim() !== ''
      ? input.outletTemp.trim()
      : String(row.出口烟气温度 ?? '')
    const outlet = parseNumber(newOutlet)
    if (outlet !== null && outlet > OUTLET_TEMP_LIMIT) {
      return {
        ok: false,
        message: `净化编号 ${code} 出口烟气温度仍为 ${outlet}℃（限值 ${OUTLET_TEMP_LIMIT}℃），指标尚未消缺，不能恢复运行；请先处理出口温度异常，实测回落至限值内再恢复`,
      }
    }
  }

  const target =
    action === '提交投运'
      ? '运行中'
      : action === '登记停运'
        ? '已停运'
        : action === '上报异常'
          ? '指标异常'
          : '运行中'

  let detail = snapshot(row)
  let updated = withFlags(row, target)

  // 处理恢复时若回填了调整后的石灰浆流量，记录旧值→新值，谁改的、什么时候改的都能倒查。
  if (action === '处理恢复') {
    if (input.limeFlow !== undefined && input.limeFlow.trim() !== '') {
      const oldFlow = isFilled(row.石灰浆流量) ? String(row.石灰浆流量) : '未填'
      const newFlow = input.limeFlow.trim()
      detail += `；石灰浆流量调整：${oldFlow} → ${newFlow}`
      updated = { ...updated, 石灰浆流量: newFlow }
    }
    if (input.outletTemp !== undefined && input.outletTemp.trim() !== '') {
      const oldOutlet = isFilled(row.出口烟气温度) ? String(row.出口烟气温度) : '未填'
      const newOutletTemp = input.outletTemp.trim()
      detail += `；出口烟气温度复测：${oldOutlet} → ${newOutletTemp}`
      updated = { ...updated, 出口烟气温度: newOutletTemp }
    }
  }

  writeTransition(row, action, target, operator, detail, note)
  const next = [...rows]
  next[index] = updated
  persist(next)

  // 任何动作落库后立刻跑一次自动判定，防止带着超限出口温度的记录停在「运行中」。
  const alerts = evaluateOutletTemps()
  const suffix =
    alerts.length > 0
      ? `；同时检测到 ${alerts.length} 条运行中记录出口烟气温度超 ${OUTLET_TEMP_LIMIT}℃，已自动切为「指标异常」并同步在线排放监测待核清单`
      : ''
  return { ok: true, message: `净化编号 ${code} 已${action}，当前状态「${target}」${suffix}` }
}

function rejectMessage(action: string, current: string, code: string): string {
  if (action === '提交投运') {
    if (current === '运行中') {
      return `净化编号 ${code} 已在「运行中」，不用重复投运`
    }
    if (current === '指标异常') {
      return `净化编号 ${code} 当前为「指标异常」，请先「处理恢复」回到「运行中」`
    }
    return `净化编号 ${code} 已停运归档，不能重新投运；如需再次运行请新登记一条净化记录`
  }
  if (action === '登记停运') {
    if (current === '待投运') {
      return `已拦截：净化编号 ${code} 还是「待投运」，不能跳过「运行中」直接停运；请先提交投运`
    }
    if (current === '指标异常') {
      return `已拦截：净化编号 ${code} 处于「指标异常」，异常态不允许直接停运归档；请先「处理恢复」回到「运行中」，指标正常后再停运`
    }
    return `净化编号 ${code} 已是「已停运」，不用重复操作`
  }
  if (action === '上报异常') {
    if (current === '待投运') {
      return `净化编号 ${code} 尚未投运，不能在「待投运」状态上报异常`
    }
    if (current === '指标异常') {
      return `净化编号 ${code} 已是「指标异常」，请直接填写处置过程后「处理恢复」`
    }
    return `净化编号 ${code} 已停运归档，不能再上报异常`
  }
  // 处理恢复
  if (current === '运行中') {
    return `净化编号 ${code} 当前为「运行中」，无需恢复`
  }
  if (current === '待投运') {
    return `净化编号 ${code} 尚未投运，没有异常态可恢复`
  }
  return `净化编号 ${code} 已停运归档，不能恢复；如需再次运行请新登记一条净化记录`
}

export type FluegasDraft = {
  净化编号: string
  反应塔温度?: string
  活性炭喷射量?: string
  石灰浆流量?: string
  出口烟气温度?: string
  操作人员?: string
}

// 登记新记录：落库即「待投运」，是否能进运行中仍要过投运前置校验。
export function createFluegasRow(draft: FluegasDraft, operator: string): ActionResult & { id?: number } {
  const code = draft.净化编号.trim()
  if (code === '') {
    return { ok: false, message: '净化编号不能为空' }
  }
  const rows = listRows('fluegas')
  if (rows.some((row) => String(row.净化编号 ?? '').trim() === code)) {
    return { ok: false, message: `净化编号 ${code} 已存在，不能重复登记` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: EntryRow = {
    id,
    status: '待投运',
    pending: true,
    abnormal: false,
    净化编号: code,
    反应塔温度: draft.反应塔温度?.trim() ?? '',
    活性炭喷射量: draft.活性炭喷射量?.trim() ?? '',
    石灰浆流量: draft.石灰浆流量?.trim() ?? '',
    出口烟气温度: draft.出口烟气温度?.trim() ?? '',
    操作人员: draft.操作人员?.trim() || operator,
    记录时间: nowText(),
    净化状态: '待投运',
  }
  persist([...rows, row])
  writeTransition(row, '登记记录', '待投运', operator, snapshot(row), '新登记，等待投运')
  return { ok: true, message: `净化编号 ${code} 已登记，当前状态「待投运」`, id }
}

// 页面上按状态决定能点哪些动作，数据层再兜底拦一次。
export function actionsForStatus(status: string): string[] {
  switch (status) {
    case '待投运':
      return ['提交投运']
    case '运行中':
      return ['登记停运', '上报异常']
    case '指标异常':
      return ['处理恢复']
    default:
      return []
  }
}
