<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import type { DataTablePageEvent } from 'primevue/datatable'
import dayjs from 'dayjs'
import DatePicker from 'primevue/datepicker'
import Skeleton from 'primevue/skeleton'
import ProgressBar from 'primevue/progressbar'
import Checkbox from 'primevue/checkbox'
import Button from '@/components/ui/AppButton.vue'
import Dialog from '@/components/ui/AppDialog.vue'
import InputText from '@/components/ui/AppInputText.vue'
import Select from '@/components/ui/AppSelect.vue'
import DataTable from '@/components/ui/AppDataTable.vue'
import Column from '@/components/ui/AppColumn.vue'
import { queryScanResult } from '@/services/api/scan'
import {
  queryBoxStateBaseList,
  queryScanTypeBaseList,
  queryWarehouseBaseList,
} from '@/services/api/category'
import { readApiFailure } from '@/services/api/error'
import { exportWebScanWorkbook, exportWebScanWorkbookFromQuery } from '@/services/scan-web-export'
import { formatDateTime, toLocalFileStamp } from '@/utils/format'
import { detectDeviceShell, type DeviceShell } from '@/adapters/platform'
import type {
  ScanQueryResultRequest,
  ViewCategoryBase,
  ViewScanResult,
  ViewWarehouseBase,
} from '@/types/api'

const { t } = useI18n()
const toast = useToast()
const rows = ref<ViewScanResult[]>([])
const loading = ref(false)
const exporting = ref(false)
const exportingAll = ref(false)
const exportProgressOpen = ref(false)
const exportProgress = ref({ done: 0, total: 0 })
const exportProgressPercent = computed(() => {
  const { done, total } = exportProgress.value
  if (!total) return 0
  return Math.min(100, Math.round((done / total) * 100))
})
const page = ref(1)
const pageSize = ref(50)
const totalRecords = ref(0)
const first = computed(() => (page.value - 1) * pageSize.value)
const shell = ref<DeviceShell>(detectDeviceShell())
const compact = computed(() => shell.value === 'mobile')
const paginatorTemplate = computed(() => {
  if (shell.value === 'mobile') return 'PrevPageLink CurrentPageReport NextPageLink'
  if (shell.value === 'tablet') return 'PrevPageLink PageLinks NextPageLink RowsPerPageDropdown'
  return 'FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown CurrentPageReport'
})
const pageReport = computed(() =>
  shell.value === 'mobile'
    ? '{first}-{last} / {totalRecords}'
    : 'Showing {first} to {last} of {totalRecords} entries',
)
const skeletonRows = Array.from({ length: 8 }, (_, index) => ({ id: `sk-${index}` }))
const tableRows = computed(() => (loading.value ? skeletonRows : rows.value))

let filterInputTimer: ReturnType<typeof setTimeout> | null = null

function emptyFilterForm(): ScanQueryResultRequest {
  return {
    locationCode: null,
    boxCode: null,
    method: null,
    scanType: null,
    warehouse: null,
    scanBy: null,
    boxState: null,
  }
}

const filterForm = ref<ScanQueryResultRequest>(emptyFilterForm())
const filterScanAt = ref<Date[] | null>(null)

const methodOptions = [
  { label: 'KeyInput', value: 'Input' as const },
  { label: 'Scan', value: 'Laser' as const },
]

function formatMethod(method: string | null | undefined) {
  if (method === 'Input') return 'KeyInput'
  if (method === 'Laser') return 'Scan'
  return method?.trim() || '—'
}

const warehouseOptions = ref<{ label: string; value: string }[]>([])
const scanTypeOptions = ref<{ label: string; value: string }[]>([])
const boxStateOptions = ref<{ label: string; value: string }[]>([])
const warehouseLoading = ref(false)
const scanTypeLoading = ref(false)
const boxStateLoading = ref(false)

function isCompleteScanAtRange(value: Date[] | null | undefined): value is [Date, Date] {
  return Boolean(value?.[0] && value?.[1])
}

function normalizeScanAtRange(
  value: Date | Date[] | (Date | null)[] | null | undefined,
): Date[] | null {
  if (!value) return null
  if (!Array.isArray(value)) return [value]
  const from = value[0] ?? null
  const to = value[1] ?? null
  if (!from && !to) return null
  return [from, to].filter((d): d is Date => d instanceof Date)
}

const hasActiveFilter = computed(
  () =>
    isCompleteScanAtRange(filterScanAt.value) ||
    Object.values(filterForm.value).some((value) => Boolean(String(value ?? '').trim())),
)

function toSelectOptions(rows: ViewCategoryBase[] | null | undefined) {
  return (rows ?? [])
    .map((row) => {
      const name = row.name?.trim() || row.code?.trim()
      if (!name) return null
      return { label: name, value: name }
    })
    .filter((row): row is { label: string; value: string } => Boolean(row))
}

function toWarehouseSelectOptions(rows: ViewWarehouseBase[] | null | undefined) {
  return (rows ?? [])
    .map((row) => {
      const name = row.warehouseName?.trim() || row.warehouseCode?.trim()
      if (!name) return null
      return { label: name, value: name }
    })
    .filter((row): row is { label: string; value: string } => Boolean(row))
}

async function loadWarehouseOptions() {
  if (warehouseLoading.value) return
  warehouseLoading.value = true
  try {
    const res = await queryWarehouseBaseList()
    warehouseOptions.value = toWarehouseSelectOptions(res.data)
  } catch {
    warehouseOptions.value = []
  } finally {
    warehouseLoading.value = false
  }
}

async function loadScanTypeOptions() {
  if (scanTypeLoading.value) return
  scanTypeLoading.value = true
  try {
    const res = await queryScanTypeBaseList()
    scanTypeOptions.value = toSelectOptions(res.data)
  } catch {
    scanTypeOptions.value = []
  } finally {
    scanTypeLoading.value = false
  }
}

async function loadBoxStateOptions() {
  if (boxStateLoading.value) return
  boxStateLoading.value = true
  try {
    const res = await queryBoxStateBaseList()
    boxStateOptions.value = toSelectOptions(res.data)
  } catch {
    boxStateOptions.value = []
  } finally {
    boxStateLoading.value = false
  }
}

function refreshShell() {
  shell.value = detectDeviceShell()
}

function buildQueryParams(): ScanQueryResultRequest {
  const params: ScanQueryResultRequest = {}
  const form = filterForm.value
  const locationCode = form.locationCode?.trim()
  const boxCode = form.boxCode?.trim()
  const method = form.method
  const scanType = form.scanType?.trim()
  const warehouse = form.warehouse?.trim()
  const scanBy = form.scanBy?.trim()
  const boxState = form.boxState?.trim()
  if (locationCode) params.locationCode = locationCode
  if (boxCode) params.boxCode = boxCode
  if (method === 'Input' || method === 'Laser') params.method = method
  if (scanType) params.scanType = scanType
  if (warehouse) params.warehouse = warehouse
  if (scanBy) params.scanBy = scanBy
  if (boxState) params.boxState = boxState
  if (isCompleteScanAtRange(filterScanAt.value)) {
    const [from, to] = filterScanAt.value
    params.scanAtFrom = `${dayjs(from).format('YYYY-MM-DD')}T00:00:00`
    params.scanAtTo = `${dayjs(to).format('YYYY-MM-DD')}T23:59:59`
  }
  params.page = page.value
  params.pageSize = pageSize.value
  return params
}

function onPage(event: DataTablePageEvent) {
  page.value = event.page + 1
  pageSize.value = event.rows
  void load()
}

function resetAndLoad() {
  page.value = 1
  void load()
}

function onBoxStateFilterChange(checked: boolean) {
  filterForm.value.boxState = checked ? 'Hỏng' : null
  resetAndLoad()
}

function onFilterTextInput() {
  if (filterInputTimer) clearTimeout(filterInputTimer)
  filterInputTimer = setTimeout(() => resetAndLoad(), 300)
}

function clearFilterInputTimer() {
  if (!filterInputTimer) return
  clearTimeout(filterInputTimer)
  filterInputTimer = null
}

function onScanAtRangeUpdate(value: Date | Date[] | (Date | null)[] | null | undefined) {
  const next = normalizeScanAtRange(value)
  filterScanAt.value = next
  if (!next || isCompleteScanAtRange(next)) resetAndLoad()
}

async function load() {
  loading.value = true
  try {
    const res = await queryScanResult(buildQueryParams())
    if (!res.success) {
      rows.value = []
      totalRecords.value = 0
      toast.add({ severity: 'error', summary: res.message || t('scan.loadError'), life: 3500 })
      return
    }
    rows.value = res.data?.items ?? []
    totalRecords.value = res.data?.totalCount ?? 0
  } catch (err) {
    rows.value = []
    totalRecords.value = 0
    toast.add({ severity: 'error', summary: readApiFailure(err) || t('scan.loadError'), life: 3500 })
  } finally {
    loading.value = false
  }
}

function clearFilters() {
  clearFilterInputTimer()
  filterForm.value = emptyFilterForm()
  filterScanAt.value = null
  resetAndLoad()
}

async function exportExcel() {
  if (!rows.value.length) {
    toast.add({ severity: 'warn', summary: t('scan.emptyTitle'), life: 2500 })
    return
  }
  exporting.value = true
  try {
    const filename = `scan-logs-${toLocalFileStamp()}.xlsx`
    const n = await exportWebScanWorkbook(filename, rows.value)
    toast.add({
      severity: 'success',
      summary: t('sync.exported', { file: filename }),
      detail: t('scan.totalCount', { n }),
      life: 3500,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: err instanceof Error ? err.message : String(err),
      life: 3500,
    })
  } finally {
    exporting.value = false
  }
}

async function exportExcelAll() {
  // if (!hasActiveFilter.value || !totalRecords.value) return
  exportingAll.value = true
  exportProgress.value = { done: 0, total: totalRecords.value }
  exportProgressOpen.value = true
  try {
    const filename = `scan-logs-all-${toLocalFileStamp()}.xlsx`
    const base = buildQueryParams()
    const n = await exportWebScanWorkbookFromQuery(
      filename,
      async (exportPage, exportPageSize) => {
        const res = await queryScanResult({
          ...base,
          page: exportPage,
          pageSize: exportPageSize,
        })
        if (!res.success) {
          throw new Error(res.message || t('scan.loadError'))
        }
        return {
          items: res.data?.items ?? [],
          totalCount: res.data?.totalCount ?? 0,
        }
      },
      (done, total) => {
        exportProgress.value = { done, total }
      },
    )
    toast.add({
      severity: 'success',
      summary: t('sync.exported', { file: filename }),
      detail: t('scan.totalCount', { n }),
      life: 3500,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: err instanceof Error ? err.message : String(err),
      life: 3500,
    })
  } finally {
    exportingAll.value = false
    exportProgressOpen.value = false
  }
}

onMounted(() => {
  refreshShell()
  window.addEventListener('resize', refreshShell)
  void load()
})

onUnmounted(() => {
  clearFilterInputTimer()
  window.removeEventListener('resize', refreshShell)
})
</script>

<template>
  <div class="page-fill">
    <div class="page-fill-panel col-span-full rounded-2xl border border-line bg-white p-2.5 shadow-panel">
      <div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h3 class="m-0 ml-3">{{ t('scan.history') }}</h3>
        <div class="flex flex-wrap items-center gap-2">
          <Button :label="compact ? undefined : t('common.clearFilter')" :ripple="false" icon="pi pi-filter-slash"
            size="small" :disabled="!hasActiveFilter" :aria-label="t('common.clearFilter')" @click="clearFilters" />
          <!-- <Button v-if="!hasActiveFilter" :label="compact ? undefined : t('common.exportExcel')" :ripple="false"
            icon="pi pi-file-excel" :loading="exporting" :disabled="!rows.length || exporting || exportingAll"
            :aria-label="t('common.exportExcel')" @click="exportExcel" /> -->
          <Button :label="compact ? undefined : t('scanResult.excelAll')" :ripple="false" size="small"
            icon="pi pi-file-export" :loading="exportingAll" :disabled="exporting"
            :aria-label="t('scanResult.excelAll')" @click="exportExcelAll" />
        </div>
      </div>
      <div class="table-wrap-fill w-full max-w-full overflow-x-auto">
        <DataTable :value="tableRows" data-key="id" lazy paginator :rows="pageSize" :first="first"
          :total-records="totalRecords" :rows-per-page-options="[50, 100, 200]" scrollable filter-display="row"
          scroll-height="flex" :paginator-template="paginatorTemplate" :current-page-report-template="pageReport"
          @page="onPage">
          <!-- <Column header="#">
            <template #body="{ index }">
              <Skeleton v-if="loading" width="1.25rem" height="1rem" />
              <template v-else>{{ (page - 1) * pageSize + index + 1 }}</template>
</template>
</Column> -->
          <Column field="scanAt" :header="t('scan.scanDate')" :show-filter-menu="false">
            <template #body="{ data }">
              <Skeleton v-if="loading" width="70%" height="1rem" />
              <template v-else>{{ formatDateTime(data.scanAt) }}</template>
            </template>
            <template #filter>
              <DatePicker v-model="filterScanAt" selection-mode="range" :manual-input="false" class="w-full"
                size="small" date-format="dd/mm/yy" show-icon show-clear :placeholder="t('scan.filterDate')"
                @update:model-value="onScanAtRangeUpdate" />
            </template>
          </Column>
          <Column field="scanBy" :header="t('scan.userId')" :show-filter-menu="false">
            <template #body="{ data }">
              <Skeleton v-if="loading" width="60%" height="1rem" />
              <template v-else>{{ data.scanBy }}</template>
            </template>
            <template #filter>
              <InputText v-model="filterForm.scanBy" class="w-full" size="small" type="text"
                :placeholder="t('scan.filterPlaceholderScanBy')" @update:model-value="onFilterTextInput" />
            </template>
          </Column>
          <Column field="scanType" :header="t('scan.scanType')" :show-filter-menu="false">
            <template #body="{ data }">
              <Skeleton v-if="loading" width="65%" height="1rem" />
              <template v-else>{{ data.scanType }}</template>
            </template>
            <template #filter>
              <Select v-model="filterForm.scanType" class="w-full" size="small" :options="scanTypeOptions"
                option-label="label" option-value="value" :loading="scanTypeLoading"
                :placeholder="t('scan.filterPlaceholderscanType')" show-clear @show="loadScanTypeOptions"
                @update:model-value="resetAndLoad" />
            </template>
          </Column>
          <Column field="method" :header="t('scan.method')" :show-filter-menu="false">
            <template #body="{ data }">
              <Skeleton v-if="loading" width="50%" height="1rem" />
              <template v-else>{{ formatMethod(data.method) }}</template>
            </template>
            <template #filter>
              <Select v-model="filterForm.method" class="w-full" size="small" :options="methodOptions"
                option-label="label" option-value="value" :placeholder="t('scan.filterPlaceholderMethod')" show-clear
                @update:model-value="resetAndLoad" />
            </template>
          </Column>
          <Column field="warehouse" :header="t('scan.warehouse')" :show-filter-menu="false">
            <template #body="{ data }">
              <Skeleton v-if="loading" width="70%" height="1rem" />
              <template v-else>{{ data.warehouse }}</template>
            </template>
            <template #filter>
              <Select v-model="filterForm.warehouse" class="w-full" size="small" :options="warehouseOptions"
                option-label="label" option-value="value" :loading="warehouseLoading"
                :placeholder="t('scan.filterPlaceholderWarehouse')" show-clear @show="loadWarehouseOptions"
                @update:model-value="resetAndLoad" />
            </template>
          </Column>
          <Column field="locationCode" :header="t('scan.location')" :show-filter-menu="false">
            <template #body="{ data }">
              <Skeleton v-if="loading" width="55%" height="1rem" />
              <template v-else>{{ data.locationCode }}</template>
            </template>
            <template #filter>
              <InputText v-model="filterForm.locationCode" class="w-full" size="small" type="text"
                :placeholder="t('scan.filterPlaceholderLocationCode')" @update:model-value="onFilterTextInput" />
            </template>
          </Column>
          <Column field="boxCode" :header="t('scan.barcode')" :show-filter-menu="false">
            <template #body="{ data }">
              <Skeleton v-if="loading" width="75%" height="1rem" />
              <template v-else>{{ data.boxCode }}</template>
            </template>
            <template #filter>
              <InputText v-model="filterForm.boxCode" class="w-full" size="small" type="text"
                :placeholder="t('scan.filterPlaceholderBoxCode')" @update:model-value="onFilterTextInput" />
            </template>
          </Column>
          <Column field="boxState" :header="t('scan.boxState')" :show-filter-menu="false">
            <template #body="{ data }">
              <Skeleton v-if="loading" width="70%" height="1rem" />
              <template v-else>{{ data.boxState ?? '—' }}</template>
            </template>
            <template #filter>
              <div class="flex w-full gap-2">
                <Checkbox :model-value="filterForm.boxState === 'Hỏng'" binary size="large"
                  inputId="scan-result-box-broken-filter" @update:model-value="onBoxStateFilterChange" />
              </div>
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

    <Dialog v-model:visible="exportProgressOpen" modal :closable="false" :close-on-escape="false"
      :dismissable-mask="false" class="scan-export-dialog" :header="t('scanResult.excelAll')"
      :style="{ width: 'min(420px, 94vw)' }">
      <div class="flex flex-col gap-3 py-1">
        <p class="m-0 text-sm text-ink">
          {{
            t('scanResult.excelAllProgress', {
              done: exportProgress.done,
              total: exportProgress.total,
            })
          }}
        </p>
        <ProgressBar :value="exportProgressPercent" />
      </div>
    </Dialog>
  </div>
</template>
