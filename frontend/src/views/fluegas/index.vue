<template>
  <section class="page" data-module="fluegas">
    <header class="page-head">
      <div>
        <h2>烟气净化运行管理</h2>
        <p class="page-desc">维护烟气净化记录，围绕净化编号、反应塔温度、活性炭喷射量、石灰浆流量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记烟气净化记录</button>
        <button class="btn" type="button" @click="exportRows">导出烟气净化运行清单</button>
      </div>
    </header>

    <p class="flow-hint">
      状态流转（数据层强校验，不可跳步）：
      <strong>待投运 → 运行中 → 已停运</strong>；运行中可挂「指标异常」，异常必须先「处理恢复」回运行中才能停运。
      出口烟气温度限值 <strong>{{ OUTLET_TEMP_LIMIT }}℃</strong>，运行中超限系统自动切「指标异常」并同步在线排放监测待核清单。
    </p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] === '' || row[column] == null ? '—' : row[column] }}</td>
          <td>
            <span :class="['tag', statusTagClass(String(row.status))]">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actionsForStatus(String(row.status))"
              :key="action"
              class="link"
              type="button"
              @click="openAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openTrace(row)">处置留痕</button>
            <span v-if="actionsForStatus(String(row.status)).length === 0" class="warn-text">已归档</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无烟气净化运行数据，可先登记烟气净化记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条烟气净化运行记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="okMessage" class="ok-text">{{ okMessage }}</span>
    </footer>

    <h3 class="section-title">石灰浆流量异常等处置过程留痕（谁、什么时候、改了什么，可倒查）</h3>
    <div class="page-actions" style="margin-bottom: 8px">
      <button class="btn" type="button" @click="downloadAudit">导出全部处置留痕</button>
      <span v-if="traceFilterCode" class="filter-item" style="font-size: 12px">
        当前仅看净化编号 {{ traceFilterCode }}：
        <button class="link" type="button" @click="traceFilterCode = ''; refreshAudit()">查看全部</button>
      </span>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>操作时间</th>
          <th>操作人员</th>
          <th>净化编号</th>
          <th>动作</th>
          <th>状态变化</th>
          <th>处置内容（含参数/前后值）</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in auditRows" :key="String(item.id)">
          <td>{{ item.time }}</td>
          <td>{{ item.operator }}</td>
          <td>{{ item.净化编号 }}</td>
          <td>{{ item.action }}</td>
          <td>{{ item.fromStatus }} → {{ item.toStatus }}</td>
          <td>{{ item.detail }}</td>
          <td>{{ item.note || '—' }}</td>
        </tr>
        <tr v-if="!auditRows.length">
          <td colspan="7" class="empty-state">暂无处置留痕</td>
        </tr>
      </tbody>
    </table>

    <!-- 登记新记录 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>登记烟气净化记录</h3>
        <div class="form-row">
          <span>净化编号<span class="required">*</span></span>
          <input v-model="createForm.净化编号" placeholder="如 FLUE-0006" />
        </div>
        <div class="form-row">
          <span>反应塔温度（投运前必填，可先登记后补录）</span>
          <input v-model="createForm.反应塔温度" placeholder="如 150 ℃" />
        </div>
        <div class="form-row">
          <span>活性炭喷射量（投运前必填）</span>
          <input v-model="createForm.活性炭喷射量" placeholder="如 8.0 kg/h" />
        </div>
        <div class="form-row">
          <span>石灰浆流量</span>
          <input v-model="createForm.石灰浆流量" placeholder="如 0.40 m³/h" />
        </div>
        <div class="form-row">
          <span>出口烟气温度</span>
          <input v-model="createForm.出口烟气温度" placeholder="如 160 ℃" />
        </div>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">保存为待投运</button>
        </div>
      </div>
    </div>

    <!-- 状态动作弹窗 -->
    <div v-if="actionOpen && activeRow" class="modal-mask" @click.self="actionOpen = false">
      <div class="modal">
        <h3>{{ activeAction }} · {{ activeRow.净化编号 }}</h3>
        <p class="flow-hint">当前状态：<strong>{{ activeRow.status }}</strong></p>
        <div v-if="activeAction === '上报异常'" class="form-row">
          <span>异常现象/原因<span class="required">*</span>（如石灰浆流量异常情况，处置过程必须留痕）</span>
          <textarea v-model="actionNote" placeholder="如：石灰浆流量骤降至 0.12 m³/h，低于 0.35 m³/h 下限，已通知检修排查管路堵塞"></textarea>
        </div>
        <div v-else-if="activeAction === '处理恢复'">
          <div class="form-row">
            <span>处置过程<span class="required">*</span>（石灰浆流量异常怎么处理的，写清楚可倒查）</span>
            <textarea v-model="actionNote" placeholder="如：疏通石灰浆管路、清洗喷枪，试喷正常，流量恢复至 0.40 m³/h，出口温度回落至 160℃"></textarea>
          </div>
          <div class="form-row">
            <span>处置后石灰浆流量（选填，回填后留痕记录 旧值→新值）</span>
            <input v-model="limeFlow" placeholder="如 0.40 m³/h" />
          </div>
          <div class="form-row">
            <span>处置后出口烟气温度复测（仍超 {{ OUTLET_TEMP_LIMIT }}℃ 将拒绝恢复）</span>
            <input v-model="outletTemp" placeholder="如 162 ℃" />
          </div>
        </div>
        <div v-else-if="activeAction === '登记停运'" class="form-row">
          <span>停运备注（选填）</span>
          <textarea v-model="actionNote" placeholder="如：按调度令正常停运"></textarea>
        </div>
        <div v-else class="form-row">
          <span>投运备注（选填）</span>
          <textarea v-model="actionNote" placeholder="确认反应塔温度、活性炭喷射量已登记"></textarea>
        </div>
        <p v-if="actionError" class="error-text">{{ actionError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="actionOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitAction">确认{{ activeAction }}</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import {
  actionsForStatus,
  createFluegasRow,
  evaluateOutletTemps,
  OUTLET_TEMP_LIMIT,
  transitionFluegas,
} from '@/api/fluegas-service'
import { exportAuditCsv, listAudit } from '@/data/audit-log'
import { useSessionStore } from '@/stores/session'
import type { AuditEntry, EntryRow } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('fluegas')
const columns = ['净化编号', '反应塔温度', '活性炭喷射量', '石灰浆流量', '出口烟气温度', '操作人员', '记录时间']
const statuses = ['待投运', '运行中', '已停运', '指标异常']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const okMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['净化编号', '反应塔温度', '活性炭喷射量']

const auditRows = ref<AuditEntry[]>([])
const traceFilterCode = ref('')

const createOpen = ref(false)
const createError = ref('')
const createForm = reactive({
  净化编号: '',
  反应塔温度: '',
  活性炭喷射量: '',
  石灰浆流量: '',
  出口烟气温度: '',
})

const actionOpen = ref(false)
const actionError = ref('')
const activeRow = ref<EntryRow | null>(null)
const activeAction = ref('')
const actionNote = ref('')
const limeFlow = ref('')
const outletTemp = ref('')

const stats = computed(() => [
  { label: '运行中净化线', value: rows.value.filter((row) => String(row.status) === '运行中').length },
  { label: '已停运净化线', value: rows.value.filter((row) => String(row.status) === '已停运').length },
  {
    label: '指标异常次数（留痕口径）',
    value: auditRows.value.filter((item) => item.toStatus === '指标异常').length,
  },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function statusTagClass(status: string): string {
  if (status === '指标异常') {
    return 'tag-abnormal'
  }
  if (status === '已停运') {
    return 'tag-done'
  }
  if (status === '运行中') {
    return 'tag-pending'
  }
  return ''
}

function flashOk(message: string) {
  okMessage.value = message
  window.setTimeout(() => {
    okMessage.value = ''
  }, 6000)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function refreshAudit() {
  auditRows.value = listAudit(traceFilterCode.value || undefined)
}

function reload() {
  errorMessage.value = ''
  try {
    // 读取前先跑出口温度自动判定：超限的运行中记录会在这里被切成指标异常并挂待核清单。
    const alerts = evaluateOutletTemps(store.operator)
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    refreshAudit()
    if (alerts.length > 0) {
      const codes = alerts.map((item) => `${item.净化编号}(${item.value}℃)`).join('、')
      flashOk(`出口烟气温度超限自动判定：${codes} 已切为「指标异常」，结果已同步在线排放监测待核清单`)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '烟气净化运行列表读取失败'
  }
}

function openCreate() {
  createError.value = ''
  createForm.净化编号 = ''
  createForm.反应塔温度 = ''
  createForm.活性炭喷射量 = ''
  createForm.石灰浆流量 = ''
  createForm.出口烟气温度 = ''
  createOpen.value = true
}

function submitCreate() {
  createError.value = ''
  const result = createFluegasRow({ ...createForm }, store.operator)
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  reload()
  flashOk(result.message)
}

function openAction(action: string, row: EntryRow) {
  actionError.value = ''
  activeRow.value = row
  activeAction.value = action
  actionNote.value = ''
  limeFlow.value = ''
  outletTemp.value = ''
  actionOpen.value = true
}

function submitAction() {
  if (!activeRow.value) {
    return
  }
  const result = transitionFluegas(Number(activeRow.value.id), activeAction.value, {
    operator: store.operator,
    note: actionNote.value,
    limeFlow: limeFlow.value,
    outletTemp: outletTemp.value,
  })
  if (!result.ok) {
    actionError.value = result.message
    return
  }
  actionOpen.value = false
  reload()
  flashOk(result.message)
}

function openTrace(row: EntryRow) {
  traceFilterCode.value = String(row.净化编号 ?? '')
  refreshAudit()
}

function downloadAudit() {
  const { filename, content } = exportAuditCsv(traceFilterCode.value || undefined)
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

onMounted(reload)
</script>
