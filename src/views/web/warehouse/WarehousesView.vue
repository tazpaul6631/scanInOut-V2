<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import type { DataTablePageEvent } from 'primevue/datatable'
import Button from '@/components/ui/AppButton.vue'
import InputText from '@/components/ui/AppInputText.vue'
import DataTable from '@/components/ui/AppDataTable.vue'
import Column from '@/components/ui/AppColumn.vue'
import { queryWarehouseResult } from '@/services/api/category'
import { readApiFailure } from '@/services/api/error'
import { detectDeviceShell, type DeviceShell } from '@/adapters/platform'
import type { ViewWarehouseResult, WarehouseQueryResultRequest } from '@/types/api'

const { t } = useI18n()
const toast = useToast()
const rows = ref<ViewWarehouseResult[]>([])
const loading = ref(false)
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

function emptyFilterForm(): WarehouseQueryResultRequest {
  return {
    factoryCode: null,
    factoryName: null,
    warehouseCode: null,
    warehouseName: null,
  }
}

const filterForm = ref<WarehouseQueryResultRequest>(emptyFilterForm())

const hasActiveFilter = computed(() =>
  Object.values(filterForm.value).some((value) => Boolean(String(value ?? '').trim())),
)

function refreshShell() {
  shell.value = detectDeviceShell()
}

function buildQueryParams(): WarehouseQueryResultRequest {
  const params: WarehouseQueryResultRequest = {}
  const form = filterForm.value
  const factoryCode = form.factoryCode?.trim()
  const factoryName = form.factoryName?.trim()
  const warehouseCode = form.warehouseCode?.trim()
  const warehouseName = form.warehouseName?.trim()
  if (factoryCode) params.factoryCode = factoryCode
  if (factoryName) params.factoryName = factoryName
  if (warehouseCode) params.warehouseCode = warehouseCode
  if (warehouseName) params.warehouseName = warehouseName
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

async function load() {
  loading.value = true
  try {
    const res = await queryWarehouseResult(buildQueryParams())
    if (!res.success) {
      rows.value = []
      totalRecords.value = 0
      toast.add({
        severity: 'error',
        summary: res.message || t('warehouses.loadError'),
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
      summary: readApiFailure(err) || t('warehouses.loadError'),
      life: 3500,
    })
  } finally {
    loading.value = false
  }
}

function clearFilters() {
  filterForm.value = emptyFilterForm()
  resetAndLoad()
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
        <h3 class="m-0">{{ t('warehouses.title') }}</h3>
        <div class="flex flex-wrap items-center gap-2">
          <Button :label="compact ? undefined : t('common.clearFilter')" :ripple="false" icon="pi pi-filter-slash"
            :disabled="!hasActiveFilter" :aria-label="t('common.clearFilter')" @click="clearFilters" />
        </div>
      </div>
      <div class="table-wrap-fill w-full max-w-full overflow-x-auto">
        <DataTable :value="rows" data-key="id" lazy paginator :rows="pageSize" :first="first"
          :total-records="totalRecords" :rows-per-page-options="[50, 100, 200]" scrollable filter-display="row"
          scroll-height="flex" :loading="loading" :paginator-template="paginatorTemplate"
          :current-page-report-template="pageReport" @page="onPage">
          <Column header="#">
            <template #body="{ index }">{{ (page - 1) * pageSize + index + 1 }}</template>
          </Column>
          <Column field="factoryCode" :header="t('warehouses.factoryCode')" :show-filter-menu="false">
            <template #body="{ data }">{{ data.factoryCode }}</template>
            <template #filter>
              <InputText v-model="filterForm.factoryCode" class="w-full" size="small" type="text"
                :placeholder="t('warehouses.filterPlaceholderFactoryCode')" @keydown.enter="resetAndLoad" />
            </template>
          </Column>
          <Column field="factoryName" :header="t('warehouses.factoryName')" :show-filter-menu="false">
            <template #body="{ data }">{{ data.factoryName }}</template>
            <template #filter>
              <InputText v-model="filterForm.factoryName" class="w-full" size="small" type="text"
                :placeholder="t('warehouses.filterPlaceholderFactoryName')" @keydown.enter="resetAndLoad" />
            </template>
          </Column>
          <Column field="warehouseCode" :header="t('warehouses.warehouseCode')" :show-filter-menu="false">
            <template #body="{ data }">{{ data.warehouseCode }}</template>
            <template #filter>
              <InputText v-model="filterForm.warehouseCode" class="w-full" size="small" type="text"
                :placeholder="t('warehouses.filterPlaceholderWarehouseCode')" @keydown.enter="resetAndLoad" />
            </template>
          </Column>
          <Column field="warehouseName" :header="t('warehouses.warehouseName')" :show-filter-menu="false">
            <template #body="{ data }">{{ data.warehouseName }}</template>
            <template #filter>
              <InputText v-model="filterForm.warehouseName" class="w-full" size="small" type="text"
                :placeholder="t('warehouses.filterPlaceholderWarehouseName')" @keydown.enter="resetAndLoad" />
            </template>
          </Column>
        </DataTable>
      </div>
    </div>
  </div>
</template>
