<script setup lang="ts">
import { computed, useSlots } from 'vue'
import DataTable from 'primevue/datatable'

defineOptions({ inheritAttrs: false })

const slots = useSlots()
const namedSlots = computed(() => Object.keys(slots).filter((name) => name !== 'default'))
</script>

<template>
  <DataTable striped-rows row-hover v-bind="$attrs">
    <slot />
    <template v-for="name in namedSlots" :key="name" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps ?? {}" />
    </template>
  </DataTable>
</template>
