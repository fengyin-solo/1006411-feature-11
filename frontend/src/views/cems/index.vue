<template>
  <section class="page" data-module="cems">
    <header class="page-head">
      <div>
        <h2>在线排放监测管理</h2>
        <p class="page-desc">维护排放监测记录，围绕监测编号、监测因子、实测值、排放限值做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记排放监测记录</button>
        <button class="btn" type="button" @click="exportRows">导出在线排放监测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">烟气净化联动待核</span>
        <strong class="stat-value">{{ pendingCount }}</strong>
      </article>
    </div>

    <h3 class="section-title">烟气净化联动待核清单</h3>
    <p class="flow-hint">
      烟气净化运行中记录出口烟气温度超过 {{ OUTLET_TEMP_LIMIT }}℃ 时，系统自动判定为「指标异常」，
      判定结果同步到本清单，须由监测人员逐条核实。
    </p>
    <div class="page-actions" style="margin-bottom: 8px">
      <button class="btn ghost" type="button" @click="showDone = !showDone; loadReview()">
        {{ showDone ? '只看待核项' : '查看已核实记录' }}
      </button>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>净化编号</th>
          <th>监测因子</th>
          <th>实测值</th>
          <th>排放限值</th>
          <th>判定结果</th>
          <th>发生时间</th>
          <th>状态</th>
          <th>核实情况</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in reviewItems" :key="String(item.id)">
          <td>{{ item.净化编号 }}</td>
          <td>{{ item.监测因子 }}</td>
          <td>{{ item.实测值 }}</td>
          <td>{{ item.排放限值 }}</td>
          <td>{{ item.判定结果 }}</td>
          <td>{{ item.发生时间 }}</td>
          <td>
            <span :class="['tag', item.status === '待核' ? 'tag-pending' : 'tag-done']">{{ item.status }}</span>
          </td>
          <td>
            <template v-if="item.status === '已核实'">
              {{ item.核实人员 }} · {{ item.核实时间 }}<br />{{ item.核实意见 }}
            </template>
            <span v-else class="warn-text">待核实</span>
          </td>
          <td class="row-actions">
            <button v-if="item.status === '待核'" class="link" type="button" @click="openAck(item)">
              核实确认
            </button>
            <span v-else>—</span>
          </td>
        </tr>
        <tr v-if="!reviewItems.length">
          <td colspan="9" class="empty-state">
            {{ showDone ? '暂无已核实记录' : '暂无联动待核项（烟气净化出口温度超限时会自动挂到这里）' }}
          </td>
        </tr>
      </tbody>
    </table>

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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无在线排放监测数据，可先登记排放监测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条在线排放监测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 联动待核项核实弹窗 -->
    <div v-if="ackOpen && active" class="modal-mask" @click.self="ackOpen = false">
      <div class="modal">
        <h3>核实联动待核项 · {{ active.净化编号 }}</h3>
        <div class="review-note">
          {{ active.监测因子 }}：实测 {{ active.实测值 }}，限值 {{ active.排放限值 }}。{{ active.判定结果 }}
        </div>
        <div class="form-row" style="margin-top: 12px">
          <span>核实意见<span class="required">*</span></span>
          <textarea v-model="ackNote" placeholder="如：核对 CEMS 历史曲线，该时段出口温度确有越限，已要求净化岗调整减温水投用"></textarea>
        </div>
        <p v-if="ackError" class="error-text">{{ ackError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="ackOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitAck">确认核实</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { OUTLET_TEMP_LIMIT } from '@/api/fluegas-service'
import { acknowledgeReview, listReviewItems } from '@/data/cems-review'
import { nowText } from '@/data/audit-log'
import { useSessionStore } from '@/stores/session'
import type { CemsReviewItem, EntryRow } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('cems')
const columns = ['监测编号', '监测因子', '实测值', '排放限值', '折算值', '采集时间', '审核人员', '监测状态']
const actions = ['提交采集', '确认审核', '标记超标']
const statuses = ['待采集', '已采集', '已审核', '超标预警']
const stats = [{ label: '待采集因子', value: 0 }, { label: '已审核因子', value: 0 }, { label: '超标预警次数', value: 0 }]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const reviewItems = ref<CemsReviewItem[]>([])
const showDone = ref(false)
const ackOpen = ref(false)
const ackError = ref('')
const ackNote = ref('')
const active = ref<CemsReviewItem | null>(null)

const pendingCount = computed(
  () => listReviewItems(false).length,
)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function loadReview() {
  reviewItems.value = listReviewItems(!showDone.value)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '排放监测记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openAck(item: CemsReviewItem) {
  active.value = item
  ackNote.value = ''
  ackError.value = ''
  ackOpen.value = true
}

function submitAck() {
  if (!active.value) {
    return
  }
  if (ackNote.value.trim() === '') {
    ackError.value = '请填写核实意见'
    return
  }
  const updated = acknowledgeReview(Number(active.value.id), store.operator, ackNote.value.trim(), nowText())
  if (!updated) {
    ackError.value = '待核项不存在或已被处理'
    return
  }
  ackOpen.value = false
  loadReview()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    loadReview()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '在线排放监测列表读取失败'
  }
}

onMounted(reload)
</script>
