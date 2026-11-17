<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Button from '@/components/ui/AppButton.vue'
import { formatDateTime } from '@/utils/format'
import { countProducts, countPendingProducts } from '@/services/repositories/products'
import { countScans } from '@/services/repositories/scans'
import { countMedia } from '@/services/repositories/media'
import { useSyncStore } from '@/stores/sync'
import { useNetworkStore } from '@/stores/network'
import { platformName, isNative } from '@/adapters/platform'

const { t } = useI18n()
const router = useRouter()
const sync = useSyncStore()
const network = useNetworkStore()
const { fromApiRunning } = storeToRefs(sync)
const products = ref(0)
const pending = ref(0)
const scans = ref(0)
const media = ref(0)

async function refreshCounts() {
  products.value = await countProducts()
  pending.value = await countPendingProducts()
  scans.value = await countScans()
  media.value = await countMedia()
  await sync.refresh()
}

watch(fromApiRunning, async (running, wasRunning) => {
  if (wasRunning && !running) await refreshCounts()
})

onMounted(refreshCounts)
</script>

<template>
  <div class="page-fill">
    <div class="page-fill-panel col-span-full rounded-2xl border border-line bg-white p-2.5 shadow-panel">
      <div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h3 class="m-0 ml-3">{{ t('dashboard.title') }}</h3>
      </div>
    </div>
  </div>
</template>
