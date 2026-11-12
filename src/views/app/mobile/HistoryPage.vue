<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConfirm } from 'primevue/useconfirm'
import DatePicker from 'primevue/datepicker'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import type { DataTablePageEvent } from 'primevue/datatable'
import Button from '@/components/ui/AppButton.vue'
import Dialog from '@/components/ui/AppDialog.vue'
import InputText from '@/components/ui/AppInputText.vue'
import FloatLabel from '@/components/ui/AppFloatLabel.vue'
import {
  countScans,
  countScansFiltered,
  deleteAllScanLogs,
  deleteScanLog,
  listScanLogsPage,
  summarizeScanLogs,
  type ScanLogFilter,
} from '@/services/repositories/scans'
import { maybeArchiveScansIfFull, SCAN_ARCHIVE_THRESHOLD } from '@/services/scan-archive'
import { exportCsvPaged, exportScanWorkbookPaged } from '@/services/export'
import { SCAN_EXPORT_COLUMNS, mapScanExportRow } from '@/services/scan-export-format'
import dayjs from 'dayjs'
import { toLocalFileStamp } from '@/utils/format'
import { useNetworkStore } from '@/stores/network'
import type { ScanLog } from '@/types'

const { t } = useI18n()
const confirm = useConfirm()
const network = useNetworkStore()
const pageRows = ref<ScanLog[]>([])
const dbTotal = ref(0)
const filteredTotal = ref(0)
const filterCode = ref('')
const filterLocation = ref('')
const filterDate = ref<Date | null>(null)
const draftCode = ref('')
const draftLocation = ref('')
const draftDate = ref<Date | null>(null)
const filterOpen = ref(false)
const page = ref(0)
const pageSize = 12
const exporting = ref(false)
const usbGuideOpen = ref(false)
const noticeOpen = ref(false)
const noticeMessage = ref('')
const EXPORT_PAGE_SIZE = 1000

function showNotice(summary: string, detail?: string) {
  noticeMessage.value = detail ? `${summary}\n${detail}` : summary
  noticeOpen.value = true
}

function userLabel(row: ScanLog) {
  return row.userCode?.trim() || row.userEmail?.trim() || '—'
}

function summaryPart(value: string) {
  const text = value.trim()
  return text || t('scan.filterEmpty')
}

const filterParts = computed(() => [
  summaryPart(filterCode.value),
  summaryPart(filterLocation.value),
  filterDate.value ? dayjs(filterDate.value).format('DD/MM/YYYY') : t('scan.filterEmpty'),
])

const filterSummary = computed(() => filterParts.value.join(' > '))

function currentFilter(): ScanLogFilter {
  const filter: ScanLogFilter = {
    code: filterCode.value,
    location: filterLocation.value,
  }
  if (filterDate.value) {
    filter.dateFrom = dayjs(filterDate.value).startOf('day').valueOf()
    filter.dateTo = dayjs(filterDate.value).endOf('day').valueOf()
  }
  return filter
}

const hasFilter = computed(() =>
  Boolean(filterCode.value.trim() || filterLocation.value.trim() || filterDate.value),
)

const paginatorTemplate =
  'FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport'
const pageReport = 'Showing {first} to {last} of {totalRecords} entries'

function rowIndex(index: number) {
  return page.value * pageSize + index + 1
}

function onPage(event: DataTablePageEvent) {
  page.value = event.page
}

async function loadPage() {
  const filter = currentFilter()
  const [filtered, total] = await Promise.all([countScansFiltered(filter), countScans()])
  filteredTotal.value = filtered
  dbTotal.value = total
  const maxPage = Math.max(0, Math.ceil(filtered / pageSize) - 1)
  if (page.value > maxPage) page.value = maxPage
  pageRows.value = await listScanLogsPage({
    ...filter,
    limit: pageSize,
    offset: page.value * pageSize,
    order: 'asc',
  })
}

watch(page, () => {
  void loadPage()
})

async function tryAutoArchive() {
  try {
    const result = await maybeArchiveScansIfFull(network.online)
    if (!result) return
    if (result.kind === 'needsOnline') {
      showNotice(t('scan.autoArchiveNeedOnline', { n: result.total, max: SCAN_ARCHIVE_THRESHOLD }))
      return
    }
    page.value = 0
    await loadPage()
    showNotice(t('scan.autoArchiveDone', { n: result.n }))
  } catch (err) {
    showNotice(err instanceof Error ? err.message : String(err))
  }
}

onMounted(async () => {
  await loadPage()
  await tryAutoArchive()
})

onActivated(async () => {
  await loadPage()
  await tryAutoArchive()
})

function openFilter() {
  draftCode.value = filterCode.value
  draftLocation.value = filterLocation.value
  draftDate.value = filterDate.value ? new Date(filterDate.value.getTime()) : null
  filterOpen.value = true
}

function applyFilter() {
  filterCode.value = draftCode.value.trim()
  filterLocation.value = draftLocation.value.trim()
  filterDate.value = draftDate.value ? new Date(draftDate.value.getTime()) : null
  filterOpen.value = false
  if (page.value !== 0) page.value = 0
  else void loadPage()
}

function clearFilter() {
  filterCode.value = ''
  filterLocation.value = ''
  filterDate.value = null
  draftCode.value = ''
  draftLocation.value = ''
  draftDate.value = null
  if (page.value !== 0) page.value = 0
  else void loadPage()
}

async function exportAllCsv(filename: string): Promise<number> {
  let index = 0
  return exportCsvPaged(filename, SCAN_EXPORT_COLUMNS, async (offset, limit) => {
    const rows = await listScanLogsPage({
      limit,
      offset,
      order: 'asc',
    })
    return rows.map((row) => {
      index += 1
      return mapScanExportRow(row, index)
    })
  }, EXPORT_PAGE_SIZE)
}

async function exportAllXlsx(filename: string): Promise<number> {
  const summary = await summarizeScanLogs()
  let index = 0
  return exportScanWorkbookPaged(
    filename,
    SCAN_EXPORT_COLUMNS,
    summary,
    async (offset, limit) => {
      const rows = await listScanLogsPage({
        limit,
        offset,
        order: 'asc',
      })
      return rows.map((row) => {
        index += 1
        return mapScanExportRow(row, index)
      })
    },
    EXPORT_PAGE_SIZE,
  )
}

async function doExport(kind: 'csv' | 'xlsx') {
  exporting.value = true
  try {
    const total = await countScans()
    if (!total) {
      showNotice(t('scan.emptyTitle'))
      return
    }
    const stamp = toLocalFileStamp()
    if (kind === 'csv') {
      const filename = `scan-logs-${stamp}.csv`
      const n = await exportAllCsv(filename)
      showNotice(t('sync.exported', { file: filename }), t('scan.totalCount', { n }))
      return
    }
    const filename = `scan-logs-${stamp}.xlsx`
    const n = await exportAllXlsx(filename)
    showNotice(t('sync.exported', { file: filename }), t('scan.totalCount', { n }))
  } catch (err) {
    showNotice(err instanceof Error ? err.message : String(err))
  } finally {
    exporting.value = false
  }
}

function deleteAll() {
  if (!dbTotal.value) {
    showNotice(t('scan.emptyTitle'))
    return
  }
  confirm.require({
    header: t('scan.deleteAllTitle'),
    message: t('scan.deleteAllMessage'),
    acceptLabel: t('common.deleteAll'),
    rejectLabel: t('common.cancel'),
    acceptIcon: 'pi pi-trash',
    acceptClass: 'p-button-danger',
    rejectClass: 'p-button-secondary',
    acceptProps: {
      raised: true,
      ripple: false,
      icon: 'pi pi-trash',
    },
    rejectProps: {
      text: true,
      raised: false,
      ripple: false,
    },
    accept: async () => {
      exporting.value = true
      try {
        const total = await countScans()
        if (!total) {
          showNotice(t('scan.emptyTitle'))
          return
        }
        const stamp = toLocalFileStamp()
        // CSV paged backup — safer than full XLSX at 100k+
        const filename = `scan-logs-backup-${stamp}.csv`
        const n = await exportAllCsv(filename)
        await deleteAllScanLogs()
        showNotice(
          t('scan.deleteAllDone'),
          `${t('sync.exported', { file: filename })} · ${t('scan.totalCount', { n })}`,
        )
        page.value = 0
        await loadPage()
      } catch (err) {
        showNotice(err instanceof Error ? err.message : t('scan.deleteError'))
      } finally {
        exporting.value = false
      }
    },
  })
}
</script>

<template>
  <div class="page-fill gap-2 overflow-hidden">
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap gap-2">
        <!-- <Button icon="pi pi-file-export" size="large" :loading="exporting" @click="doExport('csv')" /> -->
        <Button icon="pi pi-file-excel" size="large" :loading="exporting" @click="doExport('xlsx')" />
        <!-- <Button icon="pi pi-info-circle" size="large" severity="help" outlined @click="usbGuideOpen = true" /> -->
      </div>
      <div v-if="dbTotal"
        class="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#7dcea0] bg-[#d5f5e3] px-3 py-1.5">
        <p class="m-0 text-sm font-semibold text-emerald-800 flex items-center gap-1">
          <span class="tabular-nums">{{ t('scan.totalCount', { n: dbTotal }) }}</span>
          <i class="pi pi-box text-base text-emerald-700" aria-hidden="true" />
        </p>
      </div>
      <!-- <div class="flex flex-wrap gap-2 justify-end">
        <Button icon="pi pi-trash" size="large" severity="danger" outlined :loading="exporting"
          :aria-label="t('common.deleteAll')" :disabled="!dbTotal || exporting" @click="deleteAll" />
      </div> -->
    </div>

    <div class="flex shrink-0 items-stretch overflow-hidden rounded-2xl border bg-white shadow-panel"
      :class="hasFilter ? 'border-accent' : 'border-line'">
      <button type="button" class="flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent px-3 py-2.5 text-left"
        :aria-label="filterSummary" @click="openFilter">
        <div class="min-w-0 flex-1">
          <p class="m-0 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {{ t('scan.code') }} > {{ t('scan.location') }} > {{ t('scan.dateNow') }}
          </p>
          <div class="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden">
            <template v-for="(part, index) in filterParts" :key="index">
              <i v-if="index" class="pi pi-angle-right shrink-0 text-[10px] text-muted" aria-hidden="true" />
              <span class="min-w-0 truncate rounded-lg px-1.5 py-0.5 text-sm font-semibold"
                :class="part === t('scan.filterEmpty') ? 'bg-[#f3f6f5] text-muted' : 'bg-[#e8f5ef] text-ink'">
                {{ part }}
              </span>
            </template>
          </div>
        </div>
      </button>
      <button type="button"
        class="shrink-0 items-center justify-center border-0 border-l border-line bg-transparent text-green-500 px-5 "
        :disabled="!hasFilter" :aria-label="t('common.clearFilter')" @click="clearFilter">
        <i class="pi pi-filter-slash" aria-hidden="true" />
      </button>
    </div>

    <div class="history-page-panel page-fill-panel rounded-2xl border border-line bg-white p-2 shadow-panel">
      <div class="table-wrap-fill w-full max-w-full">
        <DataTable :value="pageRows" data-key="id" :lazy="true" paginator :rows="pageSize"
          :total-records="filteredTotal" :first="page * pageSize" :paginator-template="paginatorTemplate"
          :current-page-report-template="pageReport" scrollable scroll-height="flex" striped-rows row-hover
          @page="onPage">
          <Column header="#" header-class="scan-col-tight-start scan-col-tight-top" body-class="scan-col-tight-start">
            <template #body="{ index }">{{ rowIndex(index) }}</template>
          </Column>
          <Column :header="t('scan.location')" header-class="scan-col-tight scan-col-tight-top"
            body-class="scan-col-tight">
            <template #body="{ data }">
              <span class="break-all font-medium text-ink">{{ data.location || '—' }}</span>
            </template>
          </Column>
          <Column :header="t('scan.code')" header-class="scan-col-tight-top">
            <template #body="{ data }">
              <span class="break-all font-medium text-ink">{{ data.value }}</span>
            </template>
          </Column>
          <Column :header="t('scan.dateNow')" header-class="scan-col-tight scan-col-tight-top"
            body-class="scan-col-tight">
            <template #body="{ data }">
              <div class="flex flex-col whitespace-nowrap leading-tight text-muted">
                <span>{{ dayjs(data.createdAt).format('DD/MM/YYYY') }}</span>
                <span>{{ dayjs(data.createdAt).format('HH:mm:ss') }}</span>
              </div>
            </template>
          </Column>
          <Column :header="t('scan.user')" header-class="scan-col-tight-end scan-col-tight-top"
            body-class="scan-col-tight-end">
            <template #body="{ data }">
              <span class="break-all text-muted">{{ userLabel(data) }}</span>
            </template>
          </Column>
          <template #empty>
            <div
              class="table-empty flex min-h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center text-muted">
              <i class="pi pi-inbox text-[1.75rem]" />
              <p class="m-0 font-semibold text-ink">{{ t('scan.emptyTitle') }}</p>
              <p class="m-0">{{ t('scan.emptyHint') }}</p>
            </div>
          </template>
        </DataTable>
      </div>
    </div>

    <Dialog v-model:visible="noticeOpen" modal :closable="false" :header="t('scan.noticeTitle')"
      :style="{ width: 'min(420px, 96vw)' }">
      <p class="m-0 whitespace-pre-line text-lg leading-relaxed text-ink">{{ noticeMessage }}</p>
      <div class="mt-4 flex justify-end">
        <Button :label="t('common.cancel')" size="large" @click="noticeOpen = false" />
      </div>
    </Dialog>

    <Dialog v-model:visible="usbGuideOpen" modal dismissable-mask :header="t('mobile.usbGuideTitle')"
      :style="{ width: 'min(420px, 96vw)' }">
      <p class="m-0 whitespace-pre-line text-lg leading-relaxed text-ink">{{ t('mobile.usbGuideSteps') }}</p>
      <div class="mt-4 flex justify-end">
        <Button :label="t('common.cancel')" size="large" @click="usbGuideOpen = false" />
      </div>
    </Dialog>

    <Dialog v-model:visible="filterOpen" modal dismissable-mask :header="t('scan.filterTitle')"
      :style="{ width: 'min(420px, 96vw)' }" :closable="false">
      <div class="grid gap-4 mt-2">
        <FloatLabel class="w-full">
          <InputText id="history-draft-code" name="history-draft-code" v-model="draftCode" class="w-full" />
          <label for="history-draft-code">{{ t('scan.filterCode') }}</label>
        </FloatLabel>
        <FloatLabel class="w-full">
          <InputText id="history-draft-location" name="history-draft-location" v-model="draftLocation" class="w-full" />
          <label for="history-draft-location">{{ t('scan.filterLocation') }}</label>
        </FloatLabel>
        <FloatLabel class="w-full">
          <DatePicker input-id="history-draft-date" v-model="draftDate" class="w-full" date-format="dd/mm/yy" show-icon
            show-button-bar />
          <label for="history-draft-date">{{ t('scan.filterDate') }}</label>
        </FloatLabel>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <!-- <Button :label="t('common.cancel')" severity="secondary" text @click="filterOpen = false" /> -->
        <Button :label="t('common.apply')" @click="applyFilter" />
      </div>
    </Dialog>
  </div>
</template>
