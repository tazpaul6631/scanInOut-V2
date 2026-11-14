<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import InputText from '@/components/ui/AppInputText.vue'
import Password from '@/components/ui/AppPassword.vue'
import FloatLabel from '@/components/ui/AppFloatLabel.vue'
import Select from '@/components/ui/AppSelect.vue'
import Button from '@/components/ui/AppButton.vue'
import Message from '@/components/ui/AppMessage.vue'
import { createLoginSchema } from '@/schemas/login'
import { useSettingsStore } from '@/stores/settings'
import LocaleSelect from '@/components/layout/LocaleSelect.vue'
import { detectDeviceShell, homePathForShell, type DeviceShell } from '@/adapters/platform'
import { startNfcScan, stopNfcScan } from '@/adapters/nfc'
import { useBarcodeWedge } from '@/composables/useBarcodeWedge'
import { useAuthStore } from '@/stores/auth'
import { queryScanTypeBaseList, queryWarehouseBaseList } from '@/services/api/category'
import { readApiFailure } from '@/services/api/error'
import type { ViewCategoryBase, ViewWarehouseBase } from '@/types/api'

const NFC_SUPPRESS_MS = 1500
/** Colon-separated NFC UID, e.g. aa:bb:cc:dd */
const NFC_UID_COLON = /^([0-9a-f]{2}:){3,}[0-9a-f]{2}$/i
/** Long pure hex (common HID dump of UID without separators) */
const NFC_UID_HEX = /^[0-9a-f]{8,32}$/i

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const auth = useAuthStore()
const submitting = ref(false)
const credentialError = ref('')
const shell = ref<DeviceShell>(detectDeviceShell())
const isMobile = computed(() => shell.value === 'mobile')
const warehouse = ref<string | null>(null)
const scanType = ref<string | null>(null)
const warehouseOptions = ref<{ label: string; value: string }[]>([])
const typeOptions = ref<{ label: string; value: string }[]>([])
const warehouseLoading = ref(false)
const scanTypeLoading = ref(false)
const selectAttempted = ref(false)
const nfcSuppressUntil = ref(0)
const nfcRecent = ref(new Set<string>())

const mobileSelectsReady = computed(() => {
  if (!isMobile.value) return true
  return Boolean(warehouse.value?.trim() && scanType.value?.trim())
})
const warehouseInvalid = computed(
  () => isMobile.value && selectAttempted.value && !warehouse.value?.trim(),
)
const scanTypeInvalid = computed(
  () => isMobile.value && selectAttempted.value && !scanType.value?.trim(),
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
    typeOptions.value = toSelectOptions(res.data)
  } catch {
    typeOptions.value = []
  } finally {
    scanTypeLoading.value = false
  }
}

function refreshShell() {
  shell.value = detectDeviceShell()
}

function normalizeScan(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function looksLikeNfcUid(value: string): boolean {
  const raw = value.trim()
  if (!raw) return false
  if (NFC_UID_COLON.test(raw)) return true
  return NFC_UID_HEX.test(raw) && !/[g-z]/i.test(raw)
}

function rememberNfcValue(raw: string) {
  const value = raw.trim()
  if (!value) return
  const next = new Set(nfcRecent.value)
  next.add(value)
  next.add(normalizeScan(value))
  nfcRecent.value = next
  nfcSuppressUntil.value = Date.now() + NFC_SUPPRESS_MS
  employeeCode.value = ''
  clearCredentialError()
}

function shouldBlockAsNfc(value: string): boolean {
  const raw = value.trim()
  if (!raw) return false
  if (looksLikeNfcUid(raw)) return true
  if (Date.now() > nfcSuppressUntil.value) return false
  const norm = normalizeScan(raw)
  return nfcRecent.value.has(raw) || nfcRecent.value.has(norm)
}

async function armNfcSuppress() {
  if (!isMobile.value) return
  try {
    await startNfcScan((result) => {
      rememberNfcValue(result.value)
    })
  } catch {
    // No NFC hardware — laser-only login still works
  }
}

onMounted(() => {
  refreshShell()
  window.addEventListener('resize', refreshShell)
  void armNfcSuppress()
})

onUnmounted(() => {
  window.removeEventListener('resize', refreshShell)
  void stopNfcScan()
})

const { defineField, handleSubmit, errors, validateField } = useForm({
  validationSchema: computed(() => {
    void locale.value
    return toTypedSchema(createLoginSchema({ mobile: isMobile.value }))
  }),
  initialValues: { employeeCode: '', password: '' },
  validateOnMount: false,
})

const [employeeCode, employeeCodeAttrs] = defineField('employeeCode', { validateOnModelUpdate: true })
const [password, passwordAttrs] = defineField('password', { validateOnModelUpdate: true })

function clearCredentialError() {
  if (credentialError.value) credentialError.value = ''
}

function redirectAfterLogin() {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  const target = redirect.startsWith('/') && !redirect.startsWith('/login')
    ? redirect
    : homePathForShell()
  return router.replace(target)
}

async function loginWithEmployeeCode(identifier: string) {
  const value = identifier.trim()
  if (!value || submitting.value) return
  employeeCode.value = value
  credentialError.value = ''
  if (!mobileSelectsReady.value) {
    selectAttempted.value = true
    if (!warehouse.value?.trim()) {
      credentialError.value = t('auth.warehouseRequired')
      return
    }
    credentialError.value = t('auth.scanTypeRequired')
    return
  }
  selectAttempted.value = false
  submitting.value = true
  try {
    const ok = await auth.loginLocal(value, {
      warehouse: warehouse.value!,
      scanType: scanType.value!,
    })
    if (ok && auth.isLoggedIn) {
      await redirectAfterLogin()
      return
    }
    credentialError.value = t('auth.invalid')
  } catch (err) {
    credentialError.value = readApiFailure(err) || t('auth.invalid')
  } finally {
    submitting.value = false
  }
}

function onMobileSelectUpdate() {
  clearCredentialError()
  if (mobileSelectsReady.value) selectAttempted.value = false
}

useBarcodeWedge(
  (value) => {
    if (!isMobile.value) return
    if (shouldBlockAsNfc(value)) {
      employeeCode.value = ''
      clearCredentialError()
      return
    }
    void loginWithEmployeeCode(value)
  },
  { allowInputIds: ['employeeCode'], clearField: false },
)

const submit = handleSubmit(async (values) => {
  if (isMobile.value) {
    const value = values.employeeCode.trim()
    if (shouldBlockAsNfc(value)) {
      employeeCode.value = ''
      clearCredentialError()
      return
    }
    await loginWithEmployeeCode(value)
    return
  }

  credentialError.value = ''
  submitting.value = true
  try {
    const res = await auth.login(values.employeeCode, values.password)
    if (res.success && auth.isLoggedIn) {
      await redirectAfterLogin()
      return
    }
    credentialError.value = res.message || t('auth.invalid')
  } catch (err) {
    credentialError.value = readApiFailure(err) || t('auth.invalid')
  } finally {
    submitting.value = false
  }
})
</script>

<template>
  <div class="grid min-h-dvh max-h-dvh grid-rows-1 place-items-center overflow-y-auto lg:place-items-stretch lg:!p-0"
    :style="{ padding: 'calc(16px + var(--safe-top)) calc(16px + var(--safe-right)) calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left))' }"
    :data-shell="shell">
    <!-- <section
      class="hidden flex-col items-center justify-center bg-linear-to-b from-sidebar to-sidebar-2 px-10 py-12 text-[#e7f6f1] lg:flex lg:row-start-1"
      :style="{ paddingTop: 'calc(48px + var(--safe-top))', paddingLeft: 'calc(40px + var(--safe-left))' }">
      <img class="brand-mark size-[72px] rounded-[10px]" src="/logo-icon.jpg" :alt="t('app.name')" />
      <h1 class="mt-4 mb-2 text-4xl">{{ !isMobile ? t('app.webtitle') : t('app.name') }}</h1>
      <p class="m-0 opacity-80">{{ !isMobile ? settings.current.companyName : '' }}</p>
      <p class="mt-4 font-semibold opacity-100">{{ !isMobile ? t(`nav.${shell}`) : '' }}</p>
    </section> -->

    <form
      class="mx-auto grid w-full max-w-[420px] gap-3.5 rounded-2xl border border-line bg-white p-2.5 shadow-panel md:max-w-[460px] md:p-7 lg:row-start-1 lg:mt-[calc(24px+var(--safe-top))] lg:mr-[calc(24px+var(--safe-right))] lg:mb-6 lg:ml-6 lg:max-w-[420px] lg:self-center lg:justify-self-center"
      @submit.prevent="submit">
      <div class="flex flex-wrap-reverse items-center justify-center gap-3">
        <div>
          <h2 class="m-0 text-2xl">{{ t('auth.login') }}</h2>
        </div>

        <div class="flex w-full flex-row flex-wrap items-center justify-between gap-2">
          <img class="h-7 w-auto max-w-42 object-contain" src="/logo-company.png" :alt="t('app.name')" />
          <LocaleSelect :compact="shell === 'mobile'" />
        </div>
      </div>

      <div v-if="isMobile" class="grid gap-3.5">
        <div>
          <FloatLabel variant="on">
            <Select input-id="login-warehouse" v-model="warehouse" :options="warehouseOptions" option-label="label"
              option-value="value" class="w-full" :loading="warehouseLoading" :invalid="warehouseInvalid"
              @show="loadWarehouseOptions" @update:model-value="onMobileSelectUpdate" />
            <label for="login-warehouse">{{ t('auth.warehouse') }}</label>
          </FloatLabel>
          <small v-if="warehouseInvalid" class="p-error">{{ t('auth.warehouseRequired') }}</small>
        </div>
        <div>
          <FloatLabel variant="on">
            <Select input-id="login-scan-type" v-model="scanType" :options="typeOptions" option-label="label"
              option-value="value" class="w-full" :loading="scanTypeLoading" :invalid="scanTypeInvalid"
              @show="loadScanTypeOptions" @update:model-value="onMobileSelectUpdate" />
            <label for="login-scan-type">{{ t('auth.scanType') }}</label>
          </FloatLabel>
          <small v-if="scanTypeInvalid" class="p-error">{{ t('auth.scanTypeRequired') }}</small>
        </div>
      </div>
      <div>
        <FloatLabel variant="on">
          <InputText id="employeeCode" v-model="employeeCode" v-bind="employeeCodeAttrs"
            :invalid="Boolean(errors.employeeCode)" autocomplete="username" class="w-full"
            @update:model-value="clearCredentialError" />
          <label for="employeeCode">{{ t('auth.employeeCode') }}</label>
        </FloatLabel>
        <small class="p-error">{{ errors.employeeCode }}</small>
      </div>

      <div v-if="!isMobile">
        <FloatLabel variant="on">
          <Password input-id="password" v-model="password" v-bind="passwordAttrs" :invalid="Boolean(errors.password)"
            :feedback="false" toggle-mask autocomplete="current-password" class="block w-full"
            :input-style="{ width: '100%' }" @blur="void validateField('password')"
            @update:model-value="clearCredentialError" />
          <label for="password">{{ t('auth.password') }}</label>
        </FloatLabel>
        <small class="p-error">{{ errors.password }}</small>
      </div>

      <Message v-if="credentialError" severity="error">{{ credentialError }}</Message>
      <Button type="submit" :label="t('auth.login')" size="large" icon="pi pi-sign-in" :loading="submitting"
        :disabled="submitting || !mobileSelectsReady" />
      <p class="m-0 text-center text-xs text-muted">{{ t('footer.copyright') }}</p>
    </form>
  </div>
</template>
