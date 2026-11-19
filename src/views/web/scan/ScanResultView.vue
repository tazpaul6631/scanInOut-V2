<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import type { DataTablePageEvent } from 'primevue/datatable'
import dayjs from 'dayjs'
import DatePicker from 'primevue/datepicker'
import Checkbox from 'primevue/checkbox'
import Skeleton from 'primevue/skeleton'
import ProgressBar from 'primevue/progressbar'
import FloatLabel from 'primevue/floatlabel'
import Button from '@/components/ui/AppButton.vue'
import Dialog from '@/components/ui/AppDialog.vue'
import InputText from '@/components/ui/AppInputText.vue'
import Select from '@/components/ui/AppSelect.vue'
import DataTable from '@/components/ui/AppDataTable.vue'
import Column from '@/components/ui/AppColumn.vue'
import { queryScanServiceResult } from '@/services/api/scan'
import {
  queryBoxStateBaseList,
  queryScanTypeBaseList,
  queryWarehouseBaseList,
} from '@/services/api/category'
import { readApiFailure } from '@/services/api/error'
import {
  exportWebScanServiceWorkbook,
  exportWebScanServiceWorkbookFromQuery,
} from '@/services/scan-web-export'
import { formatDate, toLocalFileStamp } from '@/utils/format'
import { detectDeviceShell, type DeviceShell } from '@/adapters/platform'
import { useAuthStore } from '@/stores/auth'
import type {
  ScanQueryResultRequest,
  ViewCategoryBase,
  ViewScanServiceResult,
  ViewWarehouseBase,
} from '@/types/api'

const WARNING_ONLY_STORAGE_PREFIX = 'scanInOut.scanResult.isWarningOnly:'

const { t } = useI18n()
const toast = useToast()
const auth = useAuthStore()
const rows = ref<ViewScanServiceResult[]>([])
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
const isWarningOnly = ref(false)
const page = ref(1)
const pageSize = ref(20)
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
    outBoxBarCode: null,
    warehouseName: null,
    storageName: null,
    cutNo: null,
    smStyleCode: null,
    styleName: null,
    sizeName: null,
    boxNo: null,
    perCount: null,
    boxState: null,
  }
}

const filterForm = ref<ScanQueryResultRequest>(emptyFilterForm())
const filterScanAt = ref<Date[] | null>(null)
const filterLastLeaveDate = ref<Date[] | null>(null)

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
    isCompleteScanAtRange(filterLastLeaveDate.value) ||
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

function warningOnlyStorageKey() {
  const userId = auth.session?.userId?.trim()
  return userId ? `${WARNING_ONLY_STORAGE_PREFIX}${userId}` : null
}

function loadWarningOnlyPreference() {
  const key = warningOnlyStorageKey()
  if (!key) {
    isWarningOnly.value = false
    return
  }
  isWarningOnly.value = localStorage.getItem(key) === '1'
}

function saveWarningOnlyPreference() {
  const key = warningOnlyStorageKey()
  if (!key) return
  localStorage.setItem(key, isWarningOnly.value ? '1' : '0')
}

function onWarningOnlyChange() {
  saveWarningOnlyPreference()
  resetAndLoad()
}

function warningRowClass(data: ViewScanServiceResult) {
  return data.isWarning ? 'scan-result-warn-row' : undefined
}

function hasCellText(value: unknown) {
  return Boolean(String(value ?? '').trim())
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
  const outBoxBarCode = form.outBoxBarCode?.trim()
  const warehouseName = form.warehouseName?.trim()
  const storageName = form.storageName?.trim()
  const cutNo = form.cutNo?.trim()
  const smStyleCode = form.smStyleCode?.trim()
  const styleName = form.styleName?.trim()
  const sizeName = form.sizeName?.trim()
  const boxNo = form.boxNo?.trim()
  const perCount = form.perCount?.trim()
  const boxState = form.boxState?.trim()
  if (locationCode) params.locationCode = locationCode
  if (boxCode) params.boxCode = boxCode
  if (method === 'Input' || method === 'Laser') params.method = method
  if (scanType) params.scanType = scanType
  if (warehouse) params.warehouse = warehouse
  if (scanBy) params.scanBy = scanBy
  if (outBoxBarCode) params.outBoxBarCode = outBoxBarCode
  if (warehouseName) params.warehouseName = warehouseName
  if (storageName) params.storageName = storageName
  if (cutNo) params.cutNo = cutNo
  if (smStyleCode) params.smStyleCode = smStyleCode
  if (styleName) params.styleName = styleName
  if (sizeName) params.sizeName = sizeName
  if (boxNo) params.boxNo = boxNo
  if (perCount) params.perCount = perCount
  if (boxState) params.boxState = boxState
  if (isCompleteScanAtRange(filterScanAt.value)) {
    const [from, to] = filterScanAt.value
    params.scanAtFrom = `${dayjs(from).format('YYYY-MM-DD')}T00:00:00`
    params.scanAtTo = `${dayjs(to).format('YYYY-MM-DD')}T23:59:59`
  }
  if (isCompleteScanAtRange(filterLastLeaveDate.value)) {
    const [from, to] = filterLastLeaveDate.value
    params.lastLeaveDateFrom = `${dayjs(from).format('YYYY-MM-DD')}T00:00:00`
    params.lastLeaveDateTo = `${dayjs(to).format('YYYY-MM-DD')}T23:59:59`
  }
  if (!isWarningOnly.value) params.isWarning = true
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

function onLastLeaveDateRangeUpdate(value: Date | Date[] | (Date | null)[] | null | undefined) {
  const next = normalizeScanAtRange(value)
  filterLastLeaveDate.value = next
  if (!next || isCompleteScanAtRange(next)) resetAndLoad()
}

async function load() {
  loading.value = true
  try {
    const res = await queryScanServiceResult(buildQueryParams())
    if (!res.success) {
      rows.value = []
      totalRecords.value = 0
      toast.add({
        severity: 'error',
        summary: res.message || t('scanResult.loadError'),
        life: 3500,
      })
      return
    }
    rows.value = res.data?.items ?? []
    totalRecords.value = res.data?.totalCount ?? 0
  } catch (err) {
    rows.value = []
    totalRecords.value = 0
    toast.add({
      severity: 'error',
      summary: readApiFailure(err) || t('scanResult.loadError'),
      life: 3500,
    })
  } finally {
    loading.value = false
  }
}

function clearFilters() {
  clearFilterInputTimer()
  filterForm.value = emptyFilterForm()
  filterScanAt.value = null
  filterLastLeaveDate.value = null
  resetAndLoad()
}

async function exportExcel() {
  exporting.value = true
  try {
    const exportRows = rows.value
    if (!exportRows.length) {
      toast.add({ severity: 'warn', summary: t('scan.emptyTitle'), life: 2500 })
      return
    }
    const filename = `scan-results-${toLocalFileStamp()}.xlsx`
    const n = await exportWebScanServiceWorkbook(filename, exportRows)
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
    const filename = `scan-results-all-${toLocalFileStamp()}.xlsx`
    const base = buildQueryParams()
    const n = await exportWebScanServiceWorkbookFromQuery(
      filename,
      async (exportPage, exportPageSize) => {
        const res = await queryScanServiceResult({
          ...base,
          page: exportPage,
          pageSize: exportPageSize,
        })
        if (!res.success) {
          throw new Error(res.message || t('scanResult.loadError'))
        }
        return {
          items: res.data?.items ?? [],
          totalCount: res.data?.totalCount ?? 0,
        }
      },
      (done, total) => {
        exportProgress.value = { done, total }
      },
      200,
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
  loadWarningOnlyPreference()
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
      <div class="mb-3 flex shrink-0 flex-wrap items-center justify-space-between gap-2">
        <div class="flex flex-col gap-2">
          <h3 class="m-0 ml-3">{{ t('scanResult.title') }}</h3>
          <div class="ml-3 flex items-center gap-2">
            <Checkbox v-model="isWarningOnly" binary inputId="scan-result-warning-only" size="large"
              @update:model-value="onWarningOnlyChange" />
            <label for="scan-result-warning-only" class="m-0 cursor-pointer text-base text-ink">
              {{ t('scanResult.warningOnly') }}
            </label>
          </div>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <FloatLabel variant="on">
            <DatePicker v-model="filterScanAt" selection-mode="range" :manual-input="false" class="w-[16rem]"
              size="small" date-format="dd/mm/yy" show-icon show-clear @update:model-value="onScanAtRangeUpdate" />
            <label for="scan-result-scan-at">{{ t('scanResult.scanAt') }}</label>
          </FloatLabel>
          <FloatLabel variant="on">
            <DatePicker v-model="filterLastLeaveDate" selection-mode="range" :manual-input="false" class="w-[16rem]"
              size="small" date-format="dd/mm/yy" show-icon show-clear
              @update:model-value="onLastLeaveDateRangeUpdate" />
            <label for="scan-result-last-leave-date">{{ t('scanResult.lastLeaveDate') }}</label>
          </FloatLabel>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button :label="compact ? undefined : t('common.clearFilter')" :ripple="false" icon="pi pi-filter-slash"
            :disabled="!hasActiveFilter" :aria-label="t('common.clearFilter')" @click="clearFilters" />
          <!-- <Button v-if="!hasActiveFilter" :label="compact ? undefined : t('common.exportExcel')" :ripple="false"
            icon="pi pi-file-excel" :loading="exporting" :disabled="!rows.length || exporting || exportingAll"
            :aria-label="t('common.exportExcel')" @click="exportExcel" /> -->
          <Button :label="compact ? undefined : t('scanResult.excelAll')" :ripple="false" icon="pi pi-file-export"
            :loading="exportingAll" :disabled="exportingAll" :aria-label="t('scanResult.excelAll')"
            @click="exportExcelAll" />
        </div>
      </div>
      <div class="table-wrap-fill w-full max-w-full overflow-x-auto">
        <DataTable :value="tableRows" data-key="id" lazy paginator :rows="pageSize" :first="first"
          :total-records="totalRecords" :rows-per-page-options="[20, 50, 100]" scrollable showGridlines
          filter-display="row" scroll-height="flex" :paginator-template="paginatorTemplate"
          :current-page-report-template="pageReport" :row-class="warningRowClass" @page="onPage">
          <!-- <Column header="#" body-style=" text-align: center" frozen>
            <template #body="{ index }">
              <Skeleton v-if="loading" width="1.25rem" height="1rem" class="mx-auto" />
              <template v-else>{{ (page - 1) * pageSize + index + 1 }}</template>
</template>
</Column> -->
          <Column field="scanAt" :header="t('scanResult.scanAt')" :show-filter-menu="false"
            header-style="width: 120px; min-width: 120px; max-width: 120px"
            body-style="width: 120px; min-width: 120px; max-width: 120px" frozen>
            <template #body="{ data }">
              <Skeleton v-if="loading" width="70%" height="1rem" />
              <template v-else>{{ formatDate(data.scanAt) }}</template>
            </template>
          </Column>
          <Column field="scanBy" :header="t('scanResult.scanBy')" :show-filter-menu="false"
            header-style="width: 100px; min-width: 100px; max-width: 100px"
            body-style="width: 100px; min-width: 100px; max-width: 100px"
            filter-header-style="width: 100px; min-width: 100px; max-width: 100px; overflow: hidden" frozen>
            <template #body="{ data }">
              <Skeleton v-if="loading" width="60%" height="1rem" />
              <template v-else>{{ data.scanBy ?? '—' }}</template>
            </template>
            <template #filter>
              <InputText v-model="filterForm.scanBy" class="w-full" size="small" type="text" placeholder="..."
                @update:model-value="onFilterTextInput" />
            </template>
          </Column>
          <Column field="scanType" :header="t('scanResult.scanType')" :show-filter-menu="false"
            header-style="width: 110px; min-width: 110px; max-width: 110px"
            body-style="width: 110px; min-width: 110px; max-width: 110px"
            filter-header-style="width: 110px; min-width: 110px; max-width: 110px; overflow: hidden" frozen>
            <template #body="{ data }">
              <Skeleton v-if="loading" width="65%" height="1rem" />
              <template v-else>{{ data.scanType ?? '—' }}</template>
            </template>
            <template #filter>
              <Select v-model="filterForm.scanType" class="w-full max-w-full min-w-0" size="small"
                :options="scanTypeOptions" option-label="label" option-value="value" placeholder="..."
                :loading="scanTypeLoading" show-clear @show="loadScanTypeOptions" @update:model-value="resetAndLoad" />
            </template>
          </Column>
          <Column field="method" :header="t('scanResult.method')" :show-filter-menu="false"
            header-style="width: 110px; min-width: 110px; max-width: 110px"
            body-style="width: 110px; min-width: 110px; max-width: 110px"
            filter-header-style="width: 110px; min-width: 110px; max-width: 110px; overflow: hidden" frozen>
            <template #body="{ data }">
              <Skeleton v-if="loading" width="50%" height="1rem" />
              <template v-else>{{ formatMethod(data.method) ?? '—' }}</template>
            </template>
            <template #filter>
              <Select v-model="filterForm.method" class="w-full max-w-full min-w-0" size="small"
                :options="methodOptions" option-label="label" option-value="value" placeholder="..." show-clear
                @update:model-value="resetAndLoad" />
            </template>
          </Column>
          <Column field="warehouse" :header="t('scanResult.warehouse')" :show-filter-menu="false"
            header-style="width: 140px; min-width: 140px; max-width: 140px"
            body-style="width: 140px; min-width: 140px; max-width: 140px; padding: 0"
            filter-header-style="width: 140px; min-width: 140px; max-width: 140px; overflow: hidden" alignFrozen="Left"
            frozen>
            <template #body="{ data }">
              <div class="box-border flex min-h-[2.75rem] w-full items-center px-3"
                :class="hasCellText(data.warehouse) ? 'scan-result-warn-fill' : undefined">
                <Skeleton v-if="loading" width="70%" height="1rem" />
                <template v-else>{{ data.warehouse ?? '—' }}</template>
              </div>
            </template>
            <template #filter>
              <Select v-model="filterForm.warehouse" class="w-full max-w-full min-w-0" size="small"
                :options="warehouseOptions" option-label="label" option-value="value" placeholder="..."
                :loading="warehouseLoading" show-clear @show="loadWarehouseOptions"
                @update:model-value="resetAndLoad" />
            </template>
            <!-- <template #filter>
              <InputText v-model="filterForm.warehouse" class="w-full" size="small" type="text" placeholder="..."
                @update:model-value="onFilterTextInput" />
            </template> -->
          </Column>
          <Column field="locationCode" :header="t('scanResult.locationCode')" :show-filter-menu="false"
            header-style="width: 90px; min-width: 90px; max-width: 90px"
            body-style="width: 90px; min-width: 90px; max-width: 90px; padding: 0">
            <template #body="{ data }">
              <div class="box-border flex min-h-[2.75rem] w-full items-center px-3"
                :class="hasCellText(data.locationCode) ? 'scan-result-warn-fill' : undefined">
                <Skeleton v-if="loading" width="55%" height="1rem" />
                <template v-else>{{ data.locationCode ?? '—' }}</template>
              </div>
            </template>
            <template #filter>
              <InputText v-model="filterForm.locationCode" class="w-full" size="small" type="text" placeholder="..."
                @update:model-value="onFilterTextInput" />
            </template>
          </Column>
          <Column field="outBoxBarCode" :header="t('scanResult.outBoxBarCode')" :show-filter-menu="false"
            header-style="width: 150px; min-width: 150px; max-width: 150px"
            body-style="width: 150px; min-width: 150px; max-width: 150px; padding: 0"
            body-class="scan-result-warn-cell">
            <template #body="{ data }">
              <div class="box-border flex min-h-[2.75rem] w-full items-center px-3">
                <Skeleton v-if="loading" width="75%" height="1rem" />
                <template v-else>{{ data.outBoxBarCode ?? '—' }}</template>
              </div>
            </template>
            <template #filter>
              <InputText v-model="filterForm.outBoxBarCode" class="w-full" size="small" type="text" placeholder="..."
                @update:model-value="onFilterTextInput" />
            </template>
          </Column>
          <Column field="boxState" :header="t('scanResult.boxState')" :show-filter-menu="false"
            header-style="width: 140px; min-width: 140px; max-width: 140px"
            body-style="width: 140px; min-width: 140px; max-width: 140px; padding: 0"
            filter-header-style="width: 140px; min-width: 140px; max-width: 140px; overflow: hidden"
            body-class="scan-result-warn-cell">
            <template #body="{ data }">
              <div class="box-border flex min-h-[2.75rem] w-full items-center px-3">
                <Skeleton v-if="loading" width="70%" height="1rem" />
                <template v-else>{{ data.boxState ?? '—' }}</template>
              </div>
            </template>
            <template #filter>
              <Select v-model="filterForm.boxState" class="w-full max-w-full min-w-0" size="small"
                :options="boxStateOptions" option-label="label" option-value="value" placeholder="..."
                :loading="boxStateLoading" show-clear @show="loadBoxStateOptions" @update:model-value="resetAndLoad" />
            </template>
          </Column>
          <Column field="warehouseName" :header="t('scanResult.warehouseName')" :show-filter-menu="false"
            header-style="width: 140px; min-width: 140px; max-width: 140px"
            body-style="width: 140px; min-width: 140px; max-width: 140px; padding: 0"
            body-class="scan-result-warn-cell">
            <template #body="{ data }">
              <div class="box-border flex min-h-[2.75rem] w-full items-center px-3">
                <Skeleton v-if="loading" width="70%" height="1rem" />
                <template v-else>{{ data.warehouseName ?? '—' }}</template>
              </div>
            </template>
            <template #filter>
              <Select v-model="filterForm.warehouseName" class="w-full max-w-full min-w-0" size="small"
                :options="warehouseOptions" option-label="label" option-value="value" placeholder="..."
                :loading="warehouseLoading" show-clear @show="loadWarehouseOptions"
                @update:model-value="resetAndLoad" />
            </template>
            <!-- <template #filter>
              <InputText v-model="filterForm.warehouseName" class="w-full" size="small" type="text" placeholder="..."
                @update:model-value="onFilterTextInput" />
            </template> -->
          </Column>
          <Column field="storageName" :header="t('scanResult.storageName')" :show-filter-menu="false"
            header-style="width: 100px; min-width: 100px; max-width: 100px"
            body-style="width: 100px; min-width: 100px; max-width: 100px; padding: 0"
            body-class="scan-result-warn-cell">
            <template #body="{ data }">
              <div class="box-border flex min-h-[2.75rem] w-full items-center px-3">
                <Skeleton v-if="loading" width="60%" height="1rem" />
                <template v-else>{{ data.storageName ?? '—' }}</template>
              </div>
            </template>
            <template #filter>
              <InputText v-model="filterForm.storageName" class="w-full" size="small" type="text" placeholder="..."
                @update:model-value="onFilterTextInput" />
            </template>
          </Column>
          <Column field="cutNo" :header="t('scanResult.cutNo')" :show-filter-menu="false"
            header-style="width: 160px; min-width: 160px; max-width: 160px"
            body-style="width: 160px; min-width: 160px; max-width: 160px; padding: 0"
            body-class="scan-result-warn-cell">
            <template #body="{ data }">
              <div class="box-border flex min-h-[2.75rem] w-full items-center px-3">
                <Skeleton v-if="loading" width="80%" height="1rem" />
                <template v-else>{{ data.cutNo ?? '—' }}</template>
              </div>
            </template>
            <template #filter>
              <InputText v-model="filterForm.cutNo" class="w-full" size="small" type="text" placeholder="..."
                @update:model-value="onFilterTextInput" />
            </template>
          </Column>
          <Column field="smStyleCode" :header="t('scanResult.smStyleCode')" :show-filter-menu="false"
            header-style="width: 250px; min-width: 250px; max-width: 250px"
            body-style="width: 250px; min-width: 250px; max-width: 250px; padding: 0"
            body-class="scan-result-warn-cell">
            <template #body="{ data }">
              <div class="box-border flex min-h-[2.75rem] w-full items-center px-3">
                <Skeleton v-if="loading" width="80%" height="1rem" />
                <template v-else>{{ data.smStyleCode ?? '—' }}</template>
              </div>
            </template>
            <template #filter>
              <InputText v-model="filterForm.smStyleCode" class="w-full" size="small" type="text" placeholder="..."
                @update:model-value="onFilterTextInput" />
            </template>
          </Column>
          <Column field="styleName" :header="t('scanResult.styleName')" :show-filter-menu="false"
            header-style="width: 160px; min-width: 160px; max-width: 160px"
            body-style="width: 160px; min-width: 160px; max-width: 160px; padding: 0"
            body-class="scan-result-warn-cell">
            <template #body="{ data }">
              <div class="box-border flex min-h-[2.75rem] w-full items-center px-3">
                <Skeleton v-if="loading" width="70%" height="1rem" />
                <template v-else>{{ data.styleName ?? '—' }}</template>
              </div>
            </template>
            <template #filter>
              <InputText v-model="filterForm.styleName" class="w-full" size="small" type="text" placeholder="..."
                @update:model-value="onFilterTextInput" />
            </template>
          </Column>
          <Column field="sizeName" :header="t('scanResult.sizeName')" :show-filter-menu="false"
            header-style="width: 220px; min-width: 220px; max-width: 220px"
            body-style="width: 220px; min-width: 220px; max-width: 220px; padding: 0"
            body-class="scan-result-warn-cell">
            <template #body="{ data }">
              <div class="box-border flex min-h-[2.75rem] w-full min-w-0 items-center px-3">
                <Skeleton v-if="loading" width="75%" height="1rem" />
                <span v-else class="block w-full whitespace-normal break-words">{{ data.sizeName ?? '—' }}</span>
              </div>
            </template>
            <!-- <template #filter>
              <InputText v-model="filterForm.sizeName" class="w-full" size="small" type="text" placeholder="..."
                @update:model-value="onFilterTextInput" />
            </template> -->
          </Column>
          <Column field="boxNo" :header="t('scanResult.boxNo')" :show-filter-menu="false"
            header-style="width: 70px; min-width: 70px; max-width: 70px"
            body-style="width: 70px; min-width: 70px; max-width: 70px; padding: 0" body-class="scan-result-warn-cell">
            <template #body="{ data }">
              <div class="box-border flex min-h-[2.75rem] w-full items-center px-3">
                <Skeleton v-if="loading" width="40%" height="1rem" />
                <template v-else>{{ data.boxNo ?? '—' }}</template>
              </div>
            </template>
            <!-- <template #filter>
              <InputText v-model="filterForm.boxNo" class="w-full" size="small" type="text" placeholder="..."
                @update:model-value="onFilterTextInput" />
            </template> -->
          </Column>
          <Column field="perCount" :header="t('scanResult.perCount')" :show-filter-menu="false"
            header-style="width: 80px; min-width: 80px; max-width: 80px"
            body-style="width: 80px; min-width: 80px; max-width: 80px; padding: 0" body-class="scan-result-warn-cell">
            <template #body="{ data }">
              <div class="box-border flex min-h-[2.75rem] w-full items-center px-3">
                <Skeleton v-if="loading" width="40%" height="1rem" />
                <template v-else>{{ data.perCount ?? '—' }}</template>
              </div>
            </template>
            <!-- <template #filter>
              <InputText v-model="filterForm.perCount" class="w-full" size="small" type="text" placeholder="..."
                @update:model-value="onFilterTextInput" />
            </template> -->
          </Column>
          <Column field="lastLeaveDate" :header="t('scanResult.lastLeaveDate')" :show-filter-menu="false"
            header-style="width: 120px; min-width: 120px; max-width: 120px"
            body-style="width: 120px; min-width: 120px; max-width: 120px; padding: 0" body-class="scan-result-warn-cell"
            alignFrozen="right" frozen>
            <template #body="{ data }">
              <div class="box-border flex min-h-[2.75rem] w-full items-center px-3">
                <Skeleton v-if="loading" width="70%" height="1rem" />
                <template v-else>{{ formatDate(data.lastLeaveDate) }}</template>
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
      :dismissable-mask="false" class="scan-result-export-dialog" :header="t('scanResult.excelAll')"
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

<style scoped>
:deep(tr.scan-result-warn-row > td.scan-result-warn-cell) {
  background-color: #fef3c7;
  /* amber-100 */
}

:deep(tr.scan-result-warn-row .scan-result-warn-fill) {
  background-color: #fef3c7;
}
</style>
