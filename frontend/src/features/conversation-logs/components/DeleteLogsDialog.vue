<template>
  <BaseDialog :show="show" :title="labels.deleteTitle" width="normal" @close="emit('close')">
    <div class="space-y-4">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2"><label class="text-xs font-medium text-gray-600 dark:text-dark-300">{{ labels.start }}<input v-model="draft.start_at" type="datetime-local" class="input mt-1 h-9" /></label><label class="text-xs font-medium text-gray-600 dark:text-dark-300">{{ labels.end }}<input v-model="draft.end_at" type="datetime-local" class="input mt-1 h-9" /></label></div>
      <div v-if="error" role="alert" class="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{{ error }}</div>
      <div v-if="preview" class="border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900 dark:bg-red-950/30"><p class="text-sm font-semibold text-red-800 dark:text-red-200">{{ labels.matched }} {{ preview.matched_count }}</p><p class="mt-1 text-xs text-red-600 dark:text-red-300">{{ labels.until }} {{ formatDate(preview.expires_at) }}</p></div>
      <p v-else class="text-sm text-gray-600 dark:text-dark-300">{{ labels.deletePrompt }}</p>
    </div>
    <template #footer><button class="btn btn-secondary" :disabled="busy" @click="emit('close')">{{ labels.cancel }}</button><button v-if="!preview" class="btn btn-danger" :disabled="busy || !validRange" @click="emit('preview', { ...draft })">{{ busy ? labels.loading : labels.previewDelete }}</button><button v-else class="btn btn-danger" :disabled="busy" @click="emit('confirm')"><Icon name="trash" size="sm" class="mr-1.5" />{{ busy ? labels.deleting : labels.confirmDelete }}</button></template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import type { ConversationDeletePreview, ConversationLogFilters } from '../types'

const props = defineProps<{ show: boolean; filters: ConversationLogFilters; preview: ConversationDeletePreview | null; busy: boolean; error: string; labels: Record<string, string> }>()
const emit = defineEmits<{ close: []; preview: [filters: ConversationLogFilters]; confirm: []; criteriaChange: [] }>()
const draft = reactive<ConversationLogFilters>({ ...props.filters })
const validRange = computed(() => {
  const start = new Date(draft.start_at).getTime()
  const end = new Date(draft.end_at).getTime()
  return Number.isFinite(start) && Number.isFinite(end) && start < end
})
watch(() => props.show, (show) => { if (show) Object.assign(draft, props.filters) })
watch(() => [draft.start_at, draft.end_at], () => { if (props.preview) emit('criteriaChange') })
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
</script>
