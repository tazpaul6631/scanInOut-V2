<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import type { DataTablePageEvent } from 'primevue/datatable'
import dayjs from 'dayjs'
import DatePicker from 'primevue/datepicker'
import Button from '@/components/ui/AppButton.vue'
import InputText from '@/components/ui/AppInputText.vue'
import Select from '@/components/ui/AppSelect.vue'
import DataTable from '@/components/ui/AppDataTable.vue'
import Column from '@/components/ui/AppColumn.vue'
import { queryScanServiceResult } from '@/services/api/scan'
import { queryScanTypeBaseList, queryWarehouseBaseList } from '@/services/api/category'
import { readApiFailure } from '@/services/api/error'
import { exportWebScanServiceWorkbook } from '@/services/scan-web-export'
import { formatDateTime, toLocalFileStamp } from '@/utils/format'
import { detectDeviceShell, type DeviceShell } from '@/adapters/platform'
import type {
  ScanQueryResultRequest,
  ViewCategoryBase,
  ViewScanServiceResult,
  ViewWarehouseBase,
} from '@/types/api'

const { t } = useI18n()
const toast = useToast()
const rows = ref<ViewScanServiceResult[]>([])
const loading = ref(false)
const exporting = ref(false)
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

function emptyFilterForm(): ScanQueryResultRequest {
  return {
    locationCode: null,
    boxCode: null,
    method: null,
    scanType: null,
    warehouse: null,
    scanBy: null,
  }
}

const filterForm = ref<ScanQueryResultRequest>(emptyFilterForm())
const filterScanAt = ref<Date[] | null>(null)

const methodOptions = [
  { label: 'Input', value: 'Input' as const },
  { label: 'Laser', value: 'Laser' as const },
]

const warehouseOptions = ref<{ label: string; value: string }[]>([])
const scanTypeOptions = ref<{ label: string; value: string }[]>([])
const warehouseLoading = ref(false)
const scanTypeLoading = ref(false)

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
  if (locationCode) params.locationCode = locationCode
  if (boxCode) params.boxCode = boxCode
  if (method === 'Input' || method === 'Laser') params.method = method
  if (scanType) params.scanType = scanType
  if (warehouse) params.warehouse = warehouse
  if (scanBy) params.scanBy = scanBy
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

function onScanAtRangeUpdate(value: Date | Date[] | (Date | null)[] | null | undefined) {
  const next = normalizeScanAtRange(value)
  filterScanAt.value = next
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
    const filename = `scan-results-${toLocalFileStamp()}.xlsx`
    const n = await exportWebScanServiceWorkbook(filename, rows.value)
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

onMounted(() => {
  refreshShell()
  window.addEventListener('resize', refreshShell)
  void load()
})

onUnmounted(() => {
  window.removeEventListener('resize', refreshShell)
})
</script>

<template>
  <div class="page-fill">
    <div class="page-fill-panel col-span-full rounded-2xl border border-line bg-white p-2.5 shadow-panel">
      <div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h3 class="m-0">{{ t('scanResult.title') }}</h3>
        <div class="flex flex-wrap items-center gap-2">
          <Button :label="compact ? undefined : t('common.clearFilter')" :ripple="false" icon="pi pi-filter-slash"
            :disabled="!hasActiveFilter" :aria-label="t('common.clearFilter')" @click="clearFilters" />
          <Button :label="compact ? undefined : t('sync.excel')" :ripple="false" icon="pi pi-file-excel"
            :loading="exporting" :disabled="!rows.length || exporting" :aria-label="t('sync.excel')"
            @click="exportExcel" />
        </div>
      </div>
      <div class="table-wrap-fill w-full max-w-full overflow-x-auto">
        <DataTable :value="rows" data-key="id" lazy paginator :rows="pageSize" :first="first"
          :total-records="totalRecords" :rows-per-page-options="[50, 100, 200]" scrollable filter-display="row"
          scroll-height="flex" :loading="loading" :paginator-template="paginatorTemplate"
          :current-page-report-template="pageReport" @page="onPage">
          <Column header="#" header-style="width: 48px; min-width: 48px; max-width: 48px"
            body-style="width: 48px; min-width: 48px; max-width: 48px" frozen>
            <template #body="{ index }">{{ (page - 1) * pageSize + index + 1 }}</template>
          </Column>
          <Column field="scanAt" :header="t('scan.time')" :show-filter-menu="false"
            header-style="width: 160px; min-width: 160px; max-width: 160px"
            body-style="width: 160px; min-width: 160px; max-width: 160px" frozen>
            <template #body="{ data }">{{ formatDateTime(data.scanAt) }}</template>
            <template #filter>
              <DatePicker v-model="filterScanAt" selection-mode="range" :manual-input="false" class="w-full"
                size="small" date-format="dd/mm/yy" show-icon show-clear :placeholder="t('scan.filterDate')"
                @update:model-value="onScanAtRangeUpdate" />
            </template>
          </Column>
          <Column field="scanBy" :header="t('scan.user')" :show-filter-menu="false"
            header-style="width: 110px; min-width: 110px; max-width: 110px"
            body-style="width: 110px; min-width: 110px; max-width: 110px" frozen>
            <template #body="{ data }">{{ data.scanBy }}</template>
            <template #filter>
              <InputText v-model="filterForm.scanBy" class="w-full" size="small" type="text"
                :placeholder="t('scan.filterPlaceholderScanBy')" @keydown.enter="resetAndLoad" />
            </template>
          </Column>
          <Column field="scanType" :header="t('scan.scanType')" :show-filter-menu="false"
            header-style="width: 100px; min-width: 100px; max-width: 100px"
            body-style="width: 100px; min-width: 100px; max-width: 100px" frozen>
            <template #body="{ data }">{{ data.scanType }}</template>
            <template #filter>
              <Select v-model="filterForm.scanType" size="small" :options="scanTypeOptions" option-label="label"
                option-value="value" :loading="scanTypeLoading" :placeholder="t('scan.filterPlaceholderscanType')"
                show-clear @show="loadScanTypeOptions" @update:model-value="resetAndLoad" />
            </template>
          </Column>
          <Column field="method" :header="t('scan.method')" :show-filter-menu="false"
            header-style="width: 80px; min-width: 80px; max-width: 80px"
            body-style="width: 80px; min-width: 80px; max-width: 80px" frozen>
            <template #body="{ data }">{{ data.method }}</template>
            <template #filter>
              <Select v-model="filterForm.method" class="w-full" size="small" :options="methodOptions"
                option-label="label" option-value="value" :placeholder="t('scan.filterPlaceholderMethod')" show-clear
                @update:model-value="resetAndLoad" />
            </template>
          </Column>
          <Column field="warehouse" :header="t('scan.warehouse')" :show-filter-menu="false"
            header-style="width: 90px; min-width: 90px; max-width: 90px"
            body-style="width: 90px; min-width: 90px; max-width: 90px" frozen>
            <template #body="{ data }">{{ data.warehouse }}</template>
            <template #filter>
              <Select v-model="filterForm.warehouse" class="w-full" size="small" :options="warehouseOptions"
                option-label="label" option-value="value" :loading="warehouseLoading"
                :placeholder="t('scan.filterPlaceholderWarehouse')" show-clear @show="loadWarehouseOptions"
                @update:model-value="resetAndLoad" />
            </template>
          </Column>
          <Column field="locationCode" :header="t('scan.location')" :show-filter-menu="false"
            header-style="width: 100px; min-width: 100px; max-width: 100px"
            body-style="width: 100px; min-width: 100px; max-width: 100px" frozen>
            <template #body="{ data }">{{ data.locationCode }}</template>
            <template #filter>
              <InputText v-model="filterForm.locationCode" class="w-full" size="small" type="text"
                :placeholder="t('scan.filterPlaceholderLocationCode')" @keydown.enter="resetAndLoad" />
            </template>
          </Column>
          <Column field="outBoxBarCode" :header="t('scanResult.outBoxBarCode')" style="width: 80px"
            :show-filter-menu="false" frozen>
            <template #body="{ data }">{{ data.outBoxBarCode }}</template>
          </Column>
          <Column field="wareHouseName" :header="t('scanResult.wareHouseName')" :show-filter-menu="false">
            <template #body="{ data }">{{ data.wareHouseName }}</template>
          </Column>
          <Column field="storageName" :header="t('scanResult.storageName')" :show-filter-menu="false">
            <template #body="{ data }">{{ data.storageName }}</template>
          </Column>
          <Column field="cutNo" :header="t('scanResult.cutNo')" :show-filter-menu="false">
            <template #body="{ data }">{{ data.cutNo }}</template>
          </Column>
          <Column field="smStyleCode" :header="t('scanResult.smStyleCode')" :show-filter-menu="false">
            <template #body="{ data }">{{ data.smStyleCode }}</template>
          </Column>
          <Column field="styleName" :header="t('scanResult.styleName')" :show-filter-menu="false">
            <template #body="{ data }">{{ data.styleName }}</template>
          </Column>
          <Column field="sizeName" :header="t('scanResult.sizeName')" :show-filter-menu="false">
            <template #body="{ data }">{{ data.sizeName }}</template>
          </Column>
          <Column field="boxNo" :header="t('scanResult.boxNo')" :show-filter-menu="false">
            <template #body="{ data }">{{ data.boxNo }}</template>
          </Column>
          <Column field="perCount" :header="t('scanResult.perCount')" :show-filter-menu="false">
            <template #body="{ data }">{{ data.perCount }}</template>
          </Column>
          <Column field="lastLeaveDate" :header="t('scanResult.lastLeaveDate')" :show-filter-menu="false"
            alignFrozen="right" frozen>
            <template #body="{ data }">{{ formatDateTime(data.lastLeaveDate) }}</template>
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
  </div>
</template>
