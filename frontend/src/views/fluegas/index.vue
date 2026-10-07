<template>
  <section class="page" data-module="fluegas">
    <header class="page-head">
      <div>
        <h2>烟气净化运行管理</h2>
        <p class="page-desc">
          维护烟气净化记录，围绕净化编号、反应塔温度、活性炭喷射量、石灰浆流量做登记、筛选与状态流转。
          状态只能按「待投运 → 运行中 → 已停运」顺着流转，指标异常要先处理恢复回运行中才能停运；
          出口烟气温度超过 {{ outletLimit }}℃ 会自动切到指标异常，并同步在线排放监测的待核清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记烟气净化记录</button>
        <button class="btn" type="button" @click="exportRows">导出烟气净化运行清单</button>
      </div>
    </header>

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
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-abnormal': row.abnormal }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in rowActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openEdit(row)">修改数据</button>
            <button class="link" type="button" @click="toggleAudit(row)">留痕</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无烟气净化运行数据，可先登记烟气净化记录</td>
        </tr>
      </tbody>
    </table>

    <section v-if="editingId !== null" class="panel">
      <h3>修改运行数据（净化编号 {{ editingCode }}）</h3>
      <form class="filter-bar" @submit.prevent="saveEdit">
        <label v-for="field in metricFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="editForm[field]" :placeholder="`请输入${field}`" />
        </label>
        <button class="btn primary" type="submit">保存修改</button>
        <button class="btn ghost" type="button" @click="cancelEdit">取消</button>
      </form>
      <p class="panel-hint">每次保存都会留痕：谁、什么时候、改了哪一格，点「留痕」都能倒查。</p>
    </section>

    <section v-if="auditId !== null" class="panel">
      <h3>处置留痕（净化编号 {{ auditCode }}）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作人</th>
            <th>动作</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(entry, index) in auditEntries" :key="index">
            <td>{{ entry.time }}</td>
            <td>{{ entry.operator }}</td>
            <td>{{ entry.action }}</td>
            <td>{{ entry.detail }}</td>
          </tr>
          <tr v-if="!auditEntries.length">
            <td colspan="4" class="empty-state">暂无留痕，状态流转和数据修改都会记在这里</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条烟气净化运行记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  availableActions,
  downloadEntries,
  listEntries,
  listEntryAudit,
  moduleMeta,
  runAction as applyAction,
  updateEntry,
} from '@/api/local-service'
import { OUTLET_TEMP_LIMIT } from '@/api/fluegas-rules'
import { useSessionStore } from '@/stores/session'
import type { ActionResult, AuditEntry, EntryRow } from '@/data/types'

const meta = moduleMeta('fluegas')
const session = useSessionStore()
const columns = ["净化编号", "反应塔温度", "活性炭喷射量", "石灰浆流量", "出口烟气温度", "操作人员", "记录时间", "净化状态"]
const statuses = ["待投运", "运行中", "已停运", "指标异常"]
const metricFields = ["反应塔温度", "活性炭喷射量", "石灰浆流量", "出口烟气温度"]
const outletLimit = OUTLET_TEMP_LIMIT

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const editingId = ref<number | null>(null)
const editingCode = ref('')
const editForm = ref<Record<string, string>>({})
const auditId = ref<number | null>(null)
const auditCode = ref('')
const auditEntries = ref<AuditEntry[]>([])

const stats = computed(() => [
  { label: '运行中净化线', value: rows.value.filter((row) => row.status === '运行中').length },
  { label: '已停运净化线', value: rows.value.filter((row) => row.status === '已停运').length },
  { label: '指标异常次数', value: rows.value.filter((row) => row.status === '指标异常').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function rowActions(row: EntryRow): string[] {
  return availableActions(meta.key, row)
}

function showResult(result: ActionResult) {
  if (result.ok) {
    noticeMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    noticeMessage.value = ''
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  showResult({ ok: false, message: '烟气净化记录登记入口尚未接入审批流' })
}

function runAction(action: string, row: EntryRow) {
  const result = applyAction(meta.key, Number(row.id), action, session.operator)
  reload()
  showResult(result)
}

function openEdit(row: EntryRow) {
  auditId.value = null
  editingId.value = Number(row.id)
  editingCode.value = String(row['净化编号'] ?? '')
  editForm.value = Object.fromEntries(
    metricFields.map((field) => [field, String(row[field] ?? '')]),
  )
}

function cancelEdit() {
  editingId.value = null
  editingCode.value = ''
  editForm.value = {}
}

function saveEdit() {
  if (editingId.value === null) {
    return
  }
  const result = updateEntry(meta.key, editingId.value, { ...editForm.value }, session.operator)
  if (result.ok) {
    cancelEdit()
  }
  reload()
  showResult(result)
}

function toggleAudit(row: EntryRow) {
  const id = Number(row.id)
  if (auditId.value === id) {
    auditId.value = null
    auditCode.value = ''
    auditEntries.value = []
    return
  }
  editingId.value = null
  auditId.value = id
  auditCode.value = String(row['净化编号'] ?? '')
  auditEntries.value = listEntryAudit(meta.key, id)
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '烟气净化运行列表读取失败'
  }
}

onMounted(reload)
</script>
