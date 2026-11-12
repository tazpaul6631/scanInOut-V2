<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConfirm } from 'primevue/useconfirm'
import dayjs from 'dayjs'
import OverlayBadge from 'primevue/overlaybadge'
import Button from '@/components/ui/AppButton.vue'
import Dialog from '@/components/ui/AppDialog.vue'
import InputText from '@/components/ui/AppInputText.vue'
import FloatLabel from '@/components/ui/AppFloatLabel.vue'
import { useBarcodeWedge } from '@/composables/useBarcodeWedge'
import { createScan, syncScans, toScanApiItem } from '@/services/api/scan'
import {
  addScanLog,
  countScans,
  countScansByLocation,
  countUnsyncedScans,
  deleteScanLog,
  findScanByValue,
  listScanLogsByLocation,
  listScanLogsPage,
  listUnsyncedScansPage,
  markScansSynced,
  summarizeScanLogs,
} from '@/services/repositories/scans'
import { maybeArchiveScansIfFull } from '@/services/scan-archive'
import { exportScanWorkbookPaged, type ExportColumn } from '@/services/export'
import { toExcelLocalDate } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { useNetworkStore } from '@/stores/network'
import type { ScanKind, ScanLog } from '@/types'

const { t } = useI18n()
const auth = useAuthStore()
const network = useNetworkStore()
const confirm = useConfirm()

const locationDraft = ref('')
const activeLocation = ref('')
const boxDraft = ref('')
const sessionItems = ref<ScanLog[]>([])
const locationTotal = ref(0)
const dbTotal = ref(0)
const unsyncedCount = ref(0)
const exporting = ref(false)
const syncing = ref(false)
const noticeOpen = ref(false)
const noticeMessage = ref('')

const SYNC_CHUNK = 500
const EXPORT_PAGE_SIZE = 1000

const exportColumns = computed<ExportColumn[]>(() => [
  { key: 'index', header: '#', width: 5 },
  { key: 'location', header: 'Location', width: 16 },
  { key: 'barcode', header: 'Box', width: 28 },
  {
    key: 'datenow',
    header: 'DateNow',
    width: 22,
    numFmt: 'dd/mm/yyyy hh:mm:ss',
  },
  { key: 'userId', header: 'UserId', width: 18 },
  { key: 'method', header: 'Method', width: 12 },
])

const SWIPE_WIDTH = 80
const openSwipeId = ref<string | null>(null)
const dragOffset = ref(0)
const draggingId = ref<string | null>(null)
let touchStartX = 0
let touchStartY = 0
let touchStartOffset = 0
let ignoreClick = false

function showNotice(message: string) {
  noticeMessage.value = message
  noticeOpen.value = true
}

async function tryAutoArchive() {
  try {
    const archived = await maybeArchiveScansIfFull()
    if (!archived) return
    sessionItems.value = []
    await refreshCounts()
    showNotice(
      `${t('scan.autoArchiveDone', { n: archived.n })}\n${t('sync.exported', { file: archived.filename })}`,
    )
  } catch (err) {
    showNotice(err instanceof Error ? err.message : String(err))
  }
}

/** Cap DOM list size; banner/footer still use full SQLite COUNT. */
const SESSION_LIST_CAP = 200

const locationLocked = computed(() => Boolean(activeLocation.value.trim()))
const savedCount = computed(() => sessionItems.value.length)

function formatBadgeCount(n: number): string | undefined {
  if (n <= 0) return undefined
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.floor(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

function trimSessionList() {
  if (sessionItems.value.length > SESSION_LIST_CAP) {
    sessionItems.value = sessionItems.value.slice(0, SESSION_LIST_CAP)
  }
}

async function refreshCounts() {
  const [total, unsynced] = await Promise.all([countScans(), countUnsyncedScans()])
  dbTotal.value = total
  unsyncedCount.value = unsynced
  locationTotal.value = activeLocation.value
    ? await countScansByLocation(activeLocation.value)
    : 0
}

onMounted(async () => {
  await refreshCounts()
  await tryAutoArchive()
})

onActivated(async () => {
  await refreshCounts()
  await tryAutoArchive()
})

async function lockLocation(raw: string) {
  const code = raw.trim()
  if (!code) return
  activeLocation.value = code
  locationDraft.value = code
  sessionItems.value = await listScanLogsByLocation(code, SESSION_LIST_CAP)
  openSwipeId.value = null
  dragOffset.value = 0
  await refreshCounts()
}

function changeLocation() {
  activeLocation.value = ''
  locationDraft.value = ''
  boxDraft.value = ''
  sessionItems.value = []
  locationTotal.value = 0
  openSwipeId.value = null
  dragOffset.value = 0
}

async function saveBox(value: string, kind: ScanKind, format: string): Promise<ScanLog | null> {
  const code = value.trim()
  const location = activeLocation.value.trim()
  if (!location) {
    showNotice(t('scan.locationHint'))
    return null
  }
  if (!code) return null

  const existing = await findScanByValue(code)
  if (existing) {
    showNotice(
      existing.location
        ? t('scan.duplicateOnShelf', { location: existing.location })
        : t('scan.duplicate'),
    )
    boxDraft.value = ''
    return null
  }

  const session = auth.session
  const item = await addScanLog({
    kind,
    value: code,
    format,
    direction: 'in',
    location,
    userCode: session?.code ?? null,
    userEmail: session?.email ?? null,
  })
  sessionItems.value.unshift(item)
  trimSessionList()
  boxDraft.value = ''
  openSwipeId.value = null
  dragOffset.value = 0
  await refreshCounts()
  await tryAutoArchive()
  return item
}

async function saveLocationManual() {
  await lockLocation(locationDraft.value)
}

async function saveBoxManual() {
  const item = await saveBox(boxDraft.value, 'manual', 'MANUAL')
  if (!item || !network.online) return
  try {
    await createScan(toScanApiItem(item))
    await markScansSynced([item.id])
    const row = sessionItems.value.find((x) => x.id === item.id)
    if (row) row.synced = true
    await refreshCounts()
  } catch {
    // keep pending for batch sync
  }
}

async function syncPending() {
  if (syncing.value) return
  if (!network.online) {
    showNotice(t('sync.offline'))
    return
  }
  syncing.value = true
  try {
    let synced = 0
    for (; ;) {
      const rows = await listUnsyncedScansPage(SYNC_CHUNK, 0)
      if (!rows.length) break
      await syncScans(rows.map(toScanApiItem))
      await markScansSynced(rows.map((row) => row.id))
      const idSet = new Set(rows.map((row) => row.id))
      for (const item of sessionItems.value) {
        if (idSet.has(item.id)) item.synced = true
      }
      synced += rows.length
    }
    await refreshCounts()
    showNotice(synced ? t('scan.syncDone', { n: synced }) : t('scan.syncEmpty'))
  } catch (err) {
    showNotice(err instanceof Error ? err.message : t('scan.syncError'))
    await refreshCounts()
  } finally {
    syncing.value = false
  }
}

function rowOffset(id: string) {
  if (draggingId.value === id) return dragOffset.value
  return openSwipeId.value === id ? -SWIPE_WIDTH : 0
}

function rowBorderClass(id: string, index: number) {
  if (rowOffset(id) < 0) return 'border-[#e74c3c]'
  return index === 0 ? 'border-[#7dcea0]' : 'border-line'
}

function onTouchStart(e: TouchEvent, id: string) {
  const touch = e.touches[0]
  if (!touch) return
  touchStartX = touch.clientX
  touchStartY = touch.clientY
  touchStartOffset = openSwipeId.value === id ? -SWIPE_WIDTH : 0
  draggingId.value = id
  if (openSwipeId.value && openSwipeId.value !== id) {
    openSwipeId.value = null
  }
  dragOffset.value = touchStartOffset
}

function onTouchMove(e: TouchEvent) {
  if (!draggingId.value) return
  const touch = e.touches[0]
  if (!touch) return
  const dx = touch.clientX - touchStartX
  const dy = touch.clientY - touchStartY
  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
    draggingId.value = null
    dragOffset.value = touchStartOffset
    return
  }
  if (Math.abs(dx) > 6) {
    e.preventDefault()
  }
  dragOffset.value = Math.min(0, Math.max(-SWIPE_WIDTH, touchStartOffset + dx))
}

function onTouchEnd() {
  if (!draggingId.value) return
  const id = draggingId.value
  const moved = Math.abs(dragOffset.value - touchStartOffset) > 4
  const open = dragOffset.value <= -SWIPE_WIDTH / 2
  openSwipeId.value = open ? id : null
  dragOffset.value = open ? -SWIPE_WIDTH : 0
  draggingId.value = null
  if (moved) {
    ignoreClick = true
    setTimeout(() => {
      ignoreClick = false
    }, 0)
  }
}

function closeSwipe() {
  openSwipeId.value = null
  dragOffset.value = 0
}

function onRowClick(id: string) {
  if (ignoreClick) return
  if (openSwipeId.value === id) closeSwipe()
  else if (openSwipeId.value) closeSwipe()
}

function askDelete(row: ScanLog) {
  confirm.require({
    header: t('scan.deleteTitle'),
    message: t('scan.deleteMessage', { value: row.value }),
    acceptLabel: t('common.delete'),
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
      try {
        await deleteScanLog(row.id)
        sessionItems.value = sessionItems.value.filter((x) => x.id !== row.id)
        await refreshCounts()
      } catch (err) {
        showNotice(err instanceof Error ? err.message : t('scan.deleteError'))
      } finally {
        closeSwipe()
      }
    },
    reject: () => closeSwipe(),
    onHide: () => closeSwipe(),
  })
}

useBarcodeWedge(async (value) => {
  if (noticeOpen.value) return
  if (!locationLocked.value) {
    await lockLocation(value)
    return
  }
  await saveBox(value, 'barcode', 'WEDGE')
})
</script>

<template>
  <div class="page-fill gap-2 overflow-hidden" :style="{ paddingBottom: 'var(--safe-bottom)' }">
    <div class="page-fill-panel rounded-2xl border border-line bg-white p-3 shadow-panel">
      <div class="flex shrink-0 flex-col gap-2">
        <div class="flex items-center gap-2">
          <FloatLabel class="min-w-0 flex-1">
            <InputText id="location-input" name="location-input" v-model="locationDraft" class="w-full"
              :disabled="locationLocked" @keydown.enter.prevent="saveLocationManual" />
            <label for="location-input">{{ t('scan.locationPlaceholder') }}</label>
          </FloatLabel>
          <Button v-if="!locationLocked" type="button" :label="t('scan.lockLocation')" @click="saveLocationManual" />
          <Button v-else type="button" :label="t('scan.changeLocation')" severity="secondary" outlined
            @click="changeLocation" />
        </div>

        <p v-if="locationLocked" class="m-0 rounded-xl bg-[#d5f5e3] px-3 py-2 text-lg font-semibold text-emerald-700">
          {{ t('scan.locationActive', { location: activeLocation, n: locationTotal }) }}
        </p>
        <!-- <p v-else class="m-0 text-sm text-muted">{{ t('scan.locationHint') }}</p> -->
      </div>

      <div class="mt-3 flex shrink-0 items-center gap-2">
        <div class="flex min-w-0 flex-1 items-center gap-2" :class="{ 'opacity-50': !locationLocked }">
          <FloatLabel class="min-w-0 flex-1">
            <InputText id="manual-input" name="manual-input" v-model="boxDraft" class="w-full"
              :disabled="!locationLocked" @keydown.enter.prevent="saveBoxManual" />
            <label for="manual-input">{{ t('scan.boxPlaceholder') }}</label>
          </FloatLabel>
          <Button class="shrink-0" :label="t('common.save')" :disabled="!locationLocked" @click="saveBoxManual" />
        </div>
        <OverlayBadge v-if="unsyncedCount" :value="formatBadgeCount(unsyncedCount)" severity="warn"
          class="shrink-0 mr-3">
          <Button class="shrink-0" :disabled="!unsyncedCount || syncing"
            :icon="syncing ? 'pi pi-spin pi-spinner' : 'pi pi-cloud-upload'" :loading="syncing"
            :aria-label="t('scan.pendingSync', { n: unsyncedCount })" @click="syncPending" />
        </OverlayBadge>
      </div>

      <div v-if="!locationLocked"
        class="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-muted w-full h-full">
        <i class="pi pi-inbox text-[1.75rem]" />
        <p class="m-0 font-semibold text-ink">{{ t('scan.emptyTitle') }}</p>
      </div>

      <div v-if="sessionItems.length" class="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
        @scroll.passive="closeSwipe">
        <div v-for="(item, index) in sessionItems" :key="item.id"
          class="relative shrink-0 overflow-hidden rounded-2xl border" :class="rowBorderClass(item.id, index)">
          <div class="flex w-[calc(100%+5rem)] touch-pan-y" :style="{
            transform: `translateX(${rowOffset(item.id)}px)`,
            transition: draggingId === item.id ? 'none' : 'transform 0.18s ease',
          }" @touchstart.passive="onTouchStart($event, item.id)" @touchmove="onTouchMove" @touchend="onTouchEnd"
            @touchcancel="onTouchEnd" @click="onRowClick(item.id)">
            <div class="w-[calc(100%-5rem)] shrink-0 p-2.5" :class="index === 0 ? 'bg-[#d5f5e3]' : 'bg-white'">
              <div class="flex items-center gap-2">
                <span class="shrink-0 text-sm font-semibold text-muted">#{{ sessionItems.length - index }}</span>
                <div class="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span class="min-w-0 break-all font-medium">{{ item.value }}</span>
                  <span class="shrink-0 text-sm text-muted">{{ dayjs(item.createdAt).format('HH:mm:ss') }}</span>
                </div>
              </div>
            </div>
            <button type="button"
              class="m-0 flex w-20 shrink-0 flex-col items-center justify-center gap-0.5 border-0 bg-[#e74c3c] p-0 text-xs font-semibold text-white"
              :aria-label="t('common.delete')" @click.stop="askDelete(item)">
              <i class="pi pi-trash text-base" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div v-if="!sessionItems.length && locationLocked"
        class="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-muted w-full h-full">
        <i class="pi pi-inbox text-[1.75rem]" />
        <p class="m-0 font-semibold text-ink">{{ t('scan.emptyTitle') }}</p>
      </div>

      <!-- <p class="mb-0 mt-2 shrink-0 text-sm text-muted">
        {{
          t('mobile.sessionFooter', {
            session: savedCount,
            shelf: locationTotal,
            db: dbTotal,
          })
        }}
      </p> -->
    </div>

    <Dialog v-model:visible="noticeOpen" modal :closable="false" :header="t('scan.noticeTitle')"
      :style="{ width: 'min(420px, 96vw)' }">
      <p class="m-0 whitespace-pre-line text-lg leading-relaxed text-ink">{{ noticeMessage }}</p>
      <div class="mt-4 flex justify-end">
        <Button :label="t('common.cancel')" size="large" @click="noticeOpen = false" />
      </div>
    </Dialog>
  </div>
</template>
