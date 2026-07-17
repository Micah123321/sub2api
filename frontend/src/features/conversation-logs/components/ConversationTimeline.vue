<template>
  <section class="min-h-[360px]" aria-live="polite">
    <div v-if="loading" class="space-y-6 p-6"><div v-for="index in 4" :key="index" class="flex gap-4"><Skeleton width="70px" height="18px" /><div class="flex-1 space-y-2"><Skeleton height="14px" /><Skeleton width="72%" height="14px" /></div></div></div>
    <div v-else-if="error" role="alert" class="flex min-h-[360px] flex-col items-center justify-center gap-3 px-6 text-center"><Icon name="exclamationTriangle" size="lg" class="text-amber-500" /><p class="text-sm font-medium text-gray-900 dark:text-white">{{ labels.detailError }}</p><p class="max-w-lg text-xs text-gray-500">{{ error }}</p><button class="btn btn-secondary btn-sm" @click="emit('retry')">{{ labels.retry }}</button></div>
    <EmptyState v-else-if="!detail" :title="labels.select" description="" />
    <EmptyState v-else-if="blocks.length === 0" :title="labels.noContent" description="" />
    <template v-else>
      <header class="border-b border-gray-200 px-4 py-4 dark:border-dark-700 sm:px-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0"><p class="truncate font-mono text-xs text-gray-500">{{ detail.request_id }}</p><h2 class="mt-1 text-base font-semibold text-gray-950 dark:text-white">{{ detail.model || labels.unknownModel }}</h2></div>
          <button type="button" class="btn btn-ghost btn-sm" :title="labels.copy" @click="copyRequest"><Icon name="copy" size="sm" /></button>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-xs sm:grid-cols-4 lg:grid-cols-6">
          <div><dt>{{ labels.user }}</dt><dd>{{ detail.username_snapshot || '—' }}</dd></div><div><dt>{{ labels.provider }}</dt><dd>{{ detail.provider }} / {{ detail.transport }}</dd></div><div><dt>{{ labels.status }}</dt><dd>{{ detail.status }} · {{ detail.status_code }}</dd></div><div><dt>{{ labels.latency }}</dt><dd>{{ detail.latency_ms }} ms</dd></div><div><dt>{{ labels.messages }}</dt><dd>{{ detail.message_count }} / {{ detail.tool_call_count }}</dd></div><div><dt>{{ labels.expires }}</dt><dd>{{ formatDate(detail.expires_at) }}</dd></div>
        </dl>
        <div v-if="detail.truncated || detail.status === 'partial'" role="status" class="mt-3 flex items-center gap-2 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><Icon name="exclamationTriangle" size="sm" />{{ labels.truncated }}</div>
      </header>
      <div class="timeline px-4 py-5 sm:px-6">
        <article v-for="block in blocks" :key="block.id" class="timeline-row" :class="`role-${block.role}`">
          <div class="role-label">{{ roleLabel(block.role) }}</div>
          <div class="min-w-0 flex-1 pb-6 pl-4">
            <details v-if="block.role === 'reasoning' && block.text" class="group/reasoning"><summary class="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-300"><Icon name="chevronRight" size="xs" class="transition-transform group-open/reasoning:rotate-90" />{{ labels.reasoningData }}</summary><p class="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-700 dark:text-dark-200">{{ block.text }}</p></details>
            <p v-else-if="block.text" class="whitespace-pre-wrap break-words text-sm leading-6 text-gray-800 dark:text-dark-100">{{ block.text }}</p>
            <div v-if="block.media.length" class="mt-2 flex flex-wrap gap-2"><span v-for="(media, index) in block.media" :key="index" class="inline-flex items-center gap-1.5 rounded border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-[11px] text-gray-600 dark:border-dark-600 dark:bg-dark-800 dark:text-dark-300"><Icon name="document" size="xs" />{{ media.mime }}<template v-if="media.bytes"> · {{ formatBytes(media.bytes) }}</template></span></div>
            <details v-if="block.data !== undefined" class="mt-2 group/data" @toggle="toggleRaw(block.id, $event)"><summary class="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-gray-500"><Icon name="chevronRight" size="xs" class="transition-transform group-open/data:rotate-90" />{{ block.role === 'tool' ? labels.toolData : labels.raw }}</summary><pre v-if="expandedRaw.has(block.id)" class="mt-2 max-h-80 overflow-auto rounded border border-gray-200 bg-gray-950 p-3 text-xs leading-5 text-gray-100 dark:border-dark-600">{{ safeJSONString(block.data) }}</pre></details>
            <span v-if="block.truncated" class="mt-2 inline-block text-xs font-medium text-amber-600">{{ labels.partial }}</span>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import EmptyState from '@/components/common/EmptyState.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import Icon from '@/components/icons/Icon.vue'
import type { ConversationLogDetail, TimelineRole } from '../types'
import { formatBytes, safeJSONString, toTimeline } from '../viewModel'

const props = defineProps<{ detail: ConversationLogDetail | null; loading: boolean; error: string; labels: Record<string, string> }>()
const emit = defineEmits<{ retry: []; copied: []; copyFailed: [] }>()
const blocks = computed(() => toTimeline(props.detail?.events || []))
const expandedRaw = reactive(new Set<string>())
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
const roleLabel = (role: TimelineRole) => props.labels[`role_${role}`] || role
watch(() => props.detail?.id, () => expandedRaw.clear())
function toggleRaw(id: string, event: Event) {
  const details = event.currentTarget as HTMLDetailsElement
  if (details.open) expandedRaw.add(id)
  else expandedRaw.delete(id)
}
async function copyRequest() {
  if (!props.detail) return
  try {
    if (!navigator.clipboard) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(props.detail.request_id)
    emit('copied')
  } catch { emit('copyFailed') }
}
</script>

<style scoped>
.timeline-row { @apply relative flex min-h-14 border-l-2 border-gray-200 dark:border-dark-700; }
.role-label { @apply w-20 shrink-0 px-3 pt-0.5 text-right text-[11px] font-semibold uppercase text-gray-500; letter-spacing: 0; }
.role-system { @apply border-gray-500; } .role-developer { @apply border-cyan-600; } .role-user { @apply border-emerald-600; }
.role-assistant { @apply border-blue-600; } .role-tool { @apply border-amber-500; } .role-reasoning { @apply border-violet-500; } .role-event { @apply border-gray-300; }
dt { @apply text-gray-400; } dd { @apply mt-0.5 truncate font-medium text-gray-700 dark:text-dark-200; }
</style>
