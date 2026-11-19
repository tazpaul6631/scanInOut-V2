<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConfirm } from 'primevue/useconfirm'
import dayjs from 'dayjs'
import OverlayBadge from 'primevue/overlaybadge'
import Checkbox from 'primevue/checkbox'
import Button from '@/components/ui/AppButton.vue'
import Dialog from '@/components/ui/AppDialog.vue'
import InputText from '@/components/ui/AppInputText.vue'
import FloatLabel from '@/components/ui/AppFloatLabel.vue'
import { useBarcodeWedge } from '@/composables/useBarcodeWedge'
import { commandScan, commandScans, toScanApiItem } from '@/services/api/scan'
import {
  addScanLog,
  countScans,
  countScansByLocation,
  countUnsyncedScans,
  deleteScanLog,
  finalizeSyncedScans,
  findScanByValue,
  listScanLogsByLocation,
  listUnsyncedScansPage,
  markScanDeleted,
  updateScanBoxState,
} from '@/services/repositories/scans'
import { ensureSchema } from '@/storage/database'
import { maybeArchiveScansIfFull, SCAN_ARCHIVE_THRESHOLD } from '@/services/scan-archive'
import { useAuthStore } from '@/stores/auth'
import { useNetworkStore } from '@/stores/network'
import type { ScanKind, ScanLog } from '@/types'

const BROKEN_BOX_STATE = 'Hỏng'

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
const syncing = ref(false)
const noticeOpen = ref(false)
const noticeMessage = ref('')

const SYNC_CHUNK = 500

const SWIPE_WIDTH = 80
const openSwipeId = ref<string | null>(null)
const dragOffset = ref(0)
const draggingId = ref<string | null>(null)
let touchStartX = 0
let touchStartY = 0
let touchStartOffset = 0
let ignoreClick = false
let suppressSwipeUntil = 0

function showNotice(message: string) {
  clearSwipeState()
  noticeMessage.value = message
  noticeOpen.value = true
}

async function tryAutoArchive() {
  try {
    const result = await maybeArchiveScansIfFull(network.online)
    if (!result) return
    if (result.kind === 'needsOnline') {
      showNotice(
        t('scan.autoArchiveNeedOnline', { n: result.total, max: SCAN_ARCHIVE_THRESHOLD }),
      )
      return
    }
    sessionItems.value = []
    await refreshCounts()
    showNotice(t('scan.autoArchiveDone', { n: result.n }))
  } catch (err) {
    showNotice(err instanceof Error ? err.message : String(err))
  }
}

/** Cap DOM list size; banner/footer still use full SQLite COUNT. */
const SESSION_LIST_CAP = 200

const locationLocked = computed(() => Boolean(activeLocation.value.trim()))

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
  clearSwipeState()
  await refreshCounts()
}

function changeLocation() {
  activeLocation.value = ''
  locationDraft.value = ''
  boxDraft.value = ''
  sessionItems.value = []
  locationTotal.value = 0
  clearSwipeState()
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
  let movedFrom: string | null = null
  if (existing) {
    const oldLocation = existing.location?.trim() || ''
    if (oldLocation === location) {
      showNotice(
        oldLocation
          ? t('scan.duplicateOnShelf', { location: oldLocation })
          : t('scan.duplicate'),
      )
      boxDraft.value = ''
      return null
    }

    try {
      await deleteScanLog(existing.id)
    } catch (err) {
      showNotice(err instanceof Error ? err.message : t('scan.deleteError'))
      boxDraft.value = ''
      return null
    }

    sessionItems.value = sessionItems.value.filter((x) => x.id !== existing.id)
    movedFrom = oldLocation || null
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
    boxState: '',
  })
  sessionItems.value.unshift(item)
  trimSessionList()
  boxDraft.value = ''
  clearSwipeState()
  await refreshCounts()
  pushCommandInBackground(item, 0)
  if (movedFrom) {
    showNotice(t('scan.duplicateMoved', { location: movedFrom, newLocation: location }))
  }
  await tryAutoArchive()
  return item
}

function pushCommandInBackground(row: ScanLog, status: number) {
  if (!network.online) return
  void (async () => {
    try {
      await commandScan(toScanApiItem(row, status))
      await finalizeSyncedScans([{ ...row, status }])
      if (status !== -1) {
        const sessionRow = sessionItems.value.find((x) => x.id === row.id)
        if (sessionRow) sessionRow.synced = true
      }
      await refreshCounts()
    } catch {
      // keep pending for batch sync
    }
  })()
}

async function onRowBoxStateChange(item: ScanLog, value: string | null | undefined) {
  const next = value?.trim() || ''
  item.boxState = next
  item.synced = false
  try {
    await ensureSchema()
    await updateScanBoxState(item.id, next)
    if (network.online) pushCommandInBackground(item, item.status)
    await refreshCounts()
  } catch {
    // keep in-memory choice; retry via sync when online
  }
}

async function saveLocationManual() {
  clearSwipeState()
  await lockLocation(locationDraft.value)
}

async function saveBoxManual() {
  clearSwipeState()
  await saveBox(boxDraft.value, 'manual', 'MANUAL')
}

async function syncPending() {
  clearSwipeState()
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
      await commandScans(rows.map((row) => toScanApiItem(row, row.status)))
      await finalizeSyncedScans(rows)
      const idSet = new Set(rows.filter((row) => row.status !== -1).map((row) => row.id))
      for (const item of sessionItems.value) {
        if (idSet.has(item.id)) item.synced = true
      }
      sessionItems.value = sessionItems.value.filter((item) => !rows.some((r) => r.id === item.id && r.status === -1))
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

function clearSwipeState() {
  openSwipeId.value = null
  dragOffset.value = 0
  draggingId.value = null
}

function suppressSwipeBriefly() {
  clearSwipeState()
  suppressSwipeUntil = Date.now() + 400
}

function onTouchStart(e: TouchEvent, id: string) {
  if (Date.now() < suppressSwipeUntil) return
  const touch = e.touches[0]
  if (!touch) return
  if (openSwipeId.value && openSwipeId.value !== id) clearSwipeState()
  touchStartX = touch.clientX
  touchStartY = touch.clientY
  touchStartOffset = openSwipeId.value === id ? -SWIPE_WIDTH : 0
  draggingId.value = id
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

function onRowClick(id: string) {
  if (ignoreClick) return
  if (openSwipeId.value) clearSwipeState()
}

function onPanelPointerDown(e: PointerEvent) {
  if (!openSwipeId.value) return
  const target = e.target
  if (!(target instanceof Element)) {
    clearSwipeState()
    return
  }
  const row = target.closest('[data-swipe-id]')
  if (row?.getAttribute('data-swipe-id') === openSwipeId.value) return
  clearSwipeState()
}

function askDelete(row: ScanLog) {
  clearSwipeState()
  const finishSwipe = () => {
    void nextTick(() => suppressSwipeBriefly())
  }
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
        if (!row.synced) {
          await deleteScanLog(row.id)
        } else {
          await markScanDeleted(row.id)
          pushCommandInBackground(row, -1)
        }
        sessionItems.value = sessionItems.value.filter((x) => x.id !== row.id)
        await refreshCounts()
      } catch (err) {
        showNotice(err instanceof Error ? err.message : t('scan.deleteError'))
      } finally {
        finishSwipe()
      }
    },
    reject: finishSwipe,
    onHide: finishSwipe,
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
  <div class="page-fill gap-2 overflow-hidden">
    <div class="page-fill-panel rounded-2xl border border-line bg-white p-3 shadow-panel"
      @pointerdown.capture="onPanelPointerDown">
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
          <Button class="shrink-0" :label="t('common.save')" :disabled="!locationLocked || !boxDraft.trim()"
            @click="saveBoxManual" />
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
        @scroll.passive="clearSwipeState">
        <div v-for="(item, index) in sessionItems" :key="item.id" :data-swipe-id="item.id"
          class="relative shrink-0 overflow-hidden rounded-2xl border" :class="rowBorderClass(item.id, index)">
          <button v-show="rowOffset(item.id) < 0" type="button"
            class="absolute inset-y-0 right-0 z-0 m-0 flex w-20 flex-col items-center justify-center gap-0.5 border-0 bg-[#e74c3c] p-0 text-xs font-semibold text-white"
            :aria-label="t('common.delete')" @click.stop="askDelete(item)">
            <i class="pi pi-trash text-base" aria-hidden="true" />
          </button>
          <div class="relative z-10 w-full touch-pan-y p-2.5" :class="index === 0 ? 'bg-[#d5f5e3]' : 'bg-white'" :style="{
            transform: `translateX(${rowOffset(item.id)}px)`,
            transition: draggingId === item.id ? 'none' : 'transform 0.18s ease',
          }" @touchstart.passive="onTouchStart($event, item.id)" @touchmove="onTouchMove" @touchend="onTouchEnd"
            @touchcancel="onTouchEnd" @click="onRowClick(item.id)">
            <div class="flex items-center gap-2">
              <span class="shrink-0 text-sm font-semibold text-muted">#{{ sessionItems.length - index }}</span>
              <div class="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span class="min-w-0 break-all font-medium">{{ item.value }}</span>
                <div class="flex shrink-0 items-center gap-5" @click.stop @touchstart.stop>
                  <span class="text-sm text-muted">{{ dayjs(item.createdAt).format('HH:mm:ss') }}</span>
                  <div class="flex shrink-0 items-center gap-1">
                    <Checkbox :model-value="item.boxState?.trim() === BROKEN_BOX_STATE" binary
                      :inputId="`box-broken-${item.id}`"
                      @update:model-value="onRowBoxStateChange(item, $event ? BROKEN_BOX_STATE : '')" />
                    <label :for="`box-broken-${item.id}`" class="m-0 cursor-pointer text-sm text-ink">
                      {{ t('scan.boxBroken') }}
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!sessionItems.length && locationLocked"
        class="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-muted w-full h-full">
        <i class="pi pi-inbox text-[1.75rem]" />
        <p class="m-0 font-semibold text-ink">{{ t('scan.emptyTitle') }}</p>
      </div>
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
