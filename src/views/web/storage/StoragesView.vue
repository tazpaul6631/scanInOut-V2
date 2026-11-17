<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import type { DataTablePageEvent } from 'primevue/datatable'
import Skeleton from 'primevue/skeleton'
import Button from '@/components/ui/AppButton.vue'
import Dialog from '@/components/ui/AppDialog.vue'
import InputText from '@/components/ui/AppInputText.vue'
import DataTable from '@/components/ui/AppDataTable.vue'
import Column from '@/components/ui/AppColumn.vue'
import { queryStorageResult } from '@/services/api/category'
import { readApiFailure } from '@/services/api/error'
import { detectDeviceShell, type DeviceShell } from '@/adapters/platform'
import { toQrDataUrl } from '@/utils/qrcode'
import type { StorageQueryResultRequest, ViewStorageResult } from '@/types/api'

type PrintLabel = {
  id: number
  storageName: string
  warehouseName: string
  qrUrl: string
}

const LABEL_W_MM = 85
const LABEL_H_MM = 102
const MARGIN_X_MM = 1
const MARGIN_Y_MM = 1
const QR_MM = 77
/** 203 dpi → 8 dots/mm; 300 dpi → 12 */
const DPMM = 12

const { t } = useI18n()
const toast = useToast()
const rows = ref<ViewStorageResult[]>([])
const selected = ref<ViewStorageResult[]>([])
const loading = ref(false)
const page = ref(1)
const pageSize = ref(50)
const totalRecords = ref(0)
const first = computed(() => (page.value - 1) * pageSize.value)
const printOpen = ref(false)
const printBusy = ref(false)
const printLabels = ref<PrintLabel[]>([])
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

function emptyFilterForm(): StorageQueryResultRequest {
  return {
    warehouseCode: null,
    warehouseName: null,
    storageName: null,
  }
}

const filterForm = ref<StorageQueryResultRequest>(emptyFilterForm())

const hasActiveFilter = computed(() =>
  Object.values(filterForm.value).some((value) => Boolean(String(value ?? '').trim())),
)

function refreshShell() {
  shell.value = detectDeviceShell()
}

function buildQueryParams(): StorageQueryResultRequest {
  const params: StorageQueryResultRequest = {}
  const form = filterForm.value
  const warehouseCode = form.warehouseCode?.trim()
  const warehouseName = form.warehouseName?.trim()
  const storageName = form.storageName?.trim()
  if (warehouseCode) params.warehouseCode = warehouseCode
  if (warehouseName) params.warehouseName = warehouseName
  if (storageName) params.storageName = storageName
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

async function load() {
  loading.value = true
  selected.value = []
  try {
    const res = await queryStorageResult(buildQueryParams())
    if (!res.success) {
      rows.value = []
      totalRecords.value = 0
      toast.add({
        severity: 'error',
        summary: res.message || t('storages.loadError'),
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
      summary: readApiFailure(err) || t('storages.loadError'),
      life: 3500,
    })
  } finally {
    loading.value = false
  }
}

function clearFilters() {
  clearFilterInputTimer()
  filterForm.value = emptyFilterForm()
  resetAndLoad()
}

async function openPrintDialog() {
  const picks = selected.value.filter((row) => row.storageName?.trim())
  if (!picks.length) {
    toast.add({ severity: 'warn', summary: t('storages.printEmpty'), life: 2500 })
    return
  }
  printBusy.value = true
  printOpen.value = true
  try {
    printLabels.value = await Promise.all(
      picks.map(async (row) => {
        const storageName = row.storageName!.trim()
        return {
          id: row.id,
          storageName,
          warehouseName: row.warehouseName?.trim() || '',
          qrUrl: await toQrDataUrl(storageName, QR_MM * DPMM),
        }
      }),
    )
  } catch (err) {
    printOpen.value = false
    printLabels.value = []
    toast.add({
      severity: 'error',
      summary: err instanceof Error ? err.message : String(err),
      life: 3500,
    })
  } finally {
    printBusy.value = false
  }
}

function closePrintDialog() {
  printOpen.value = false
  printLabels.value = []
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildPrintDocumentHtml(labels: PrintLabel[]) {
  const cards = labels
    .map((label) => {
      const warehouse = label.warehouseName
        ? `<div class="wh">${escapeHtml(label.warehouseName)}</div>`
        : ''
      const qr = label.qrUrl
        ? `<img class="qr" src="${escapeHtml(label.qrUrl)}" alt="${escapeHtml(label.storageName)}" />`
        : ''
      return `<article class="card">${warehouse}${qr}<div class="name">${escapeHtml(label.storageName)}</div></article>`
    })
    .join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(t('storages.printTitle'))}</title>
  <style>
    @page {
      size: ${LABEL_W_MM}mm ${LABEL_H_MM}mm;
      margin: 0;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: ${LABEL_W_MM}mm;
      height: ${LABEL_H_MM}mm;
      font-family: Arial, Helvetica, sans-serif;
      color: #000;
      background: #fff;
    }
    .card {
      width: ${LABEL_W_MM}mm;
      height: ${LABEL_H_MM}mm;
      padding: ${MARGIN_Y_MM}mm ${MARGIN_X_MM}mm;
      margin: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
    }
    .card:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .wh, .name {
      width: 100%;
      margin: 0;
      padding: 0;
      text-align: center;
      font-weight: 900;
      word-break: break-word;
    }
    .wh { font-size: 2rem; line-height: 0.8; }
    .name { font-size: 4rem; line-height: 0.7; }
    .qr {
      width: ${QR_MM}mm;
      height: ${QR_MM}mm;
      margin: 0;
      display: block;
    }
  </style>
</head>
<body>${cards}</body>
</html>`
}

async function waitForPrintImages(doc: Document) {
  const images = [...doc.images]
  if (!images.length) return
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve()
            return
          }
          img.onload = () => resolve()
          img.onerror = () => resolve()
        }),
    ),
  )
}

async function printLabelsNow() {
  if (!printLabels.value.length) {
    toast.add({ severity: 'warn', summary: t('storages.printEmpty'), life: 2500 })
    return
  }

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.opacity = '0'
  iframe.style.pointerEvents = 'none'
  document.body.appendChild(iframe)

  const frameWindow = iframe.contentWindow
  const frameDoc = frameWindow?.document
  if (!frameWindow || !frameDoc) {
    iframe.remove()
    toast.add({ severity: 'warn', summary: t('storages.printBlocked'), life: 3500 })
    return
  }

  frameDoc.open()
  frameDoc.write(buildPrintDocumentHtml(printLabels.value))
  frameDoc.close()

  try {
    await waitForPrintImages(frameDoc)
    frameWindow.focus()
    frameWindow.print()
  } finally {
    window.setTimeout(() => iframe.remove(), 1000)
  }
}

watch(printOpen, (open) => {
  if (!open) printLabels.value = []
})

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
        <h3 class="m-0 ml-3">{{ t('storages.title') }}</h3>
        <div class="flex flex-wrap items-center gap-2">
          <Button :label="compact ? undefined : t('storages.print')" icon="pi pi-qrcode" :ripple="false"
            :disabled="!selected.length" :aria-label="t('storages.print')" @click="openPrintDialog" />
          <Button :label="compact ? undefined : t('common.clearFilter')" :ripple="false" icon="pi pi-filter-slash"
            :disabled="!hasActiveFilter" :aria-label="t('common.clearFilter')" @click="clearFilters" />
        </div>
      </div>
      <div class="table-wrap-fill w-full max-w-full overflow-x-auto">
        <DataTable v-model:selection="selected" :value="tableRows" data-key="id" selection-mode="multiple" lazy
          paginator :rows="pageSize" :first="first" :total-records="totalRecords"
          :rows-per-page-options="[50, 100, 200]" scrollable filter-display="row" scroll-height="flex"
          :paginator-template="paginatorTemplate" :current-page-report-template="pageReport" @page="onPage">
          <Column selection-mode="multiple" header-style="width: 3rem" />
          <Column header="#">
            <template #body="{ index }">
              <Skeleton v-if="loading" width="1.25rem" height="1rem" />
              <template v-else>{{ (page - 1) * pageSize + index + 1 }}</template>
            </template>
          </Column>
          <Column field="warehouseCode" :header="t('storages.warehouseCode')" :show-filter-menu="false">
            <template #body="{ data }">
              <Skeleton v-if="loading" width="55%" height="1rem" />
              <template v-else>{{ data.warehouseCode }}</template>
            </template>
            <template #filter>
              <InputText v-model="filterForm.warehouseCode" class="w-full" size="small" type="text"
                :placeholder="t('storages.filterPlaceholderWarehouseCode')" @update:model-value="onFilterTextInput" />
            </template>
          </Column>
          <Column field="warehouseName" :header="t('storages.warehouseName')" :show-filter-menu="false">
            <template #body="{ data }">
              <Skeleton v-if="loading" width="70%" height="1rem" />
              <template v-else>{{ data.warehouseName }}</template>
            </template>
            <template #filter>
              <InputText v-model="filterForm.warehouseName" class="w-full" size="small" type="text"
                :placeholder="t('storages.filterPlaceholderWarehouseName')" @update:model-value="onFilterTextInput" />
            </template>
          </Column>
          <Column field="storageName" :header="t('storages.storageName')" :show-filter-menu="false">
            <template #body="{ data }">
              <Skeleton v-if="loading" width="60%" height="1rem" />
              <template v-else>{{ data.storageName }}</template>
            </template>
            <template #filter>
              <InputText v-model="filterForm.storageName" class="w-full" size="small" type="text"
                :placeholder="t('storages.filterPlaceholderStorageName')" @update:model-value="onFilterTextInput" />
            </template>
          </Column>
        </DataTable>
      </div>
    </div>

    <Dialog v-model:visible="printOpen" modal dismissable-mask class="storage-print-dialog"
      :header="t('storages.printTitle')" :closable="false"
      :style="{ width: printLabels.length >= 3 ? 'min(800px, 96vw)' : 'min(400px, 94vw)' }">
      <div v-if="printBusy" class="flex items-center justify-center py-10 text-sm text-muted">
        <i class="pi pi-spin pi-spinner mr-2" aria-hidden="true" />
        …
      </div>

      <div v-else id="storage-label-print"
        class="storage-print-root max-h-[60vh] justify-items-center gap-5 overflow-y-auto p-4"
        :class="printLabels.length >= 3 ? 'grid grid-cols-3' : 'flex flex-col items-center'">
        <article v-for="label in printLabels" :key="label.id"
          class="storage-label-card flex h-[254px] w-[212px] flex-col items-center justify-center gap-0 rounded border border-line bg-white px-[8px] py-[4px]">
          <div v-if="label.warehouseName" class="storage-label-wh text-center text-xl font-bold leading-none text-ink">
            {{ label.warehouseName }}
          </div>
          <img v-if="label.qrUrl" :src="label.qrUrl" :alt="label.storageName"
            class="storage-label-qr h-[185px] w-[185px]" />
          <div class="storage-label-name text-center text-4xl font-bold leading-none text-ink">
            {{ label.storageName }}
          </div>
        </article>
      </div>

      <template #footer>
        <Button :label="t('common.cancel')" severity="secondary" text :ripple="false" @click="closePrintDialog" />
        <Button :label="t('storages.printAction')" icon="pi pi-print" :ripple="false"
          :disabled="printBusy || !printLabels.length" @click="printLabelsNow" />
      </template>
    </Dialog>
  </div>
</template>
