<template>
  <div class="min-h-[240px]">
    <div v-if="loading" class="space-y-px p-3" aria-label="Loading">
      <div v-for="index in 6" :key="index" class="grid grid-cols-[120px_1fr_120px] gap-4 border-b border-gray-100 py-3 dark:border-dark-700"><Skeleton height="16px" /><Skeleton height="16px" /><Skeleton height="16px" /></div>
    </div>
    <div v-else-if="error" role="alert" class="flex min-h-[240px] flex-col items-center justify-center gap-3 px-6 text-center"><Icon name="exclamationCircle" size="lg" class="text-red-500" /><p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p><button class="btn btn-secondary btn-sm" @click="emit('retry')">{{ labels.retry }}</button></div>
    <EmptyState v-else-if="items.length === 0" :title="labels.empty" description="" />
    <template v-else>
      <div class="hidden overflow-auto md:block">
        <table class="w-full table-fixed">
          <thead><tr><th class="w-40">{{ labels.time }}</th><th class="w-44">{{ labels.identity }}</th><th>{{ labels.preview }}</th><th class="w-44">{{ labels.route }}</th><th class="w-28">{{ labels.status }}</th><th class="w-24 text-right">{{ labels.latency }}</th></tr></thead>
          <tbody>
            <tr v-for="item in items" :key="item.id" :aria-selected="selectedId === item.id" class="transition-colors hover:bg-gray-50 dark:hover:bg-dark-700/60" :class="selectedId === item.id ? 'bg-primary-50/70 dark:bg-primary-950/20' : ''">
              <td class="font-mono text-xs text-gray-500 dark:text-dark-300">{{ formatDate(item.completed_at) }}</td>
              <td><p class="truncate font-medium text-gray-900 dark:text-white">{{ item.username_snapshot || `#${item.user_id ?? '—'}` }}</p><p class="truncate text-xs text-gray-500">{{ item.api_key_name_snapshot || '—' }}</p></td>
              <td><button type="button" class="block w-full rounded px-1 py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500" :aria-label="`${labels.select}: ${item.preview || item.request_id}`" @click="emit('select', item.id)"><span class="block truncate text-sm text-gray-800 dark:text-dark-100">{{ item.preview || labels.noPreview }}</span><span class="mt-0.5 block truncate font-mono text-[11px] text-gray-400">{{ item.request_id }}</span></button></td>
              <td><p class="truncate text-xs font-semibold uppercase text-gray-700 dark:text-dark-200">{{ item.provider }} · {{ item.transport }}</p><p class="truncate text-xs text-gray-500">{{ item.model }}</p></td>
              <td><span :class="statusClass(item.status)" class="inline-flex rounded px-2 py-1 text-[11px] font-semibold">{{ statusLabel(item.status) }}</span><span v-if="item.truncated" class="ml-1 text-amber-600">!</span></td>
              <td class="text-right font-mono text-xs text-gray-600 dark:text-dark-300">{{ item.latency_ms }} ms</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="divide-y divide-gray-100 md:hidden dark:divide-dark-700">
        <button v-for="item in items" :key="item.id" type="button" class="block w-full px-4 py-3 text-left" :class="selectedId === item.id ? 'bg-primary-50 dark:bg-primary-950/20' : ''" @click="emit('select', item.id)">
          <div class="flex items-center justify-between gap-3"><span class="font-mono text-[11px] text-gray-500">{{ formatDate(item.completed_at) }}</span><span :class="statusClass(item.status)" class="rounded px-2 py-0.5 text-[10px] font-semibold">{{ statusLabel(item.status) }}</span></div>
          <p class="mt-1 truncate text-sm font-medium text-gray-900 dark:text-white">{{ item.preview || labels.noPreview }}</p>
          <p class="mt-1 truncate text-xs text-gray-500">{{ item.provider }} · {{ item.model }} · {{ item.username_snapshot || '—' }}</p>
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import EmptyState from '@/components/common/EmptyState.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import Icon from '@/components/icons/Icon.vue'
import type { ConversationLogRecord } from '../types'

const props = defineProps<{ items: ConversationLogRecord[]; selectedId: number | null; loading: boolean; error: string; labels: Record<string, string> }>()
const emit = defineEmits<{ select: [id: number]; retry: [] }>()
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value))
const statusLabel = (status: string) => props.labels[`status_${status}`] || status
const statusClass = (status: string) => ({
  completed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  blocked: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  partial: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-dark-300',
}[status] || 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-dark-300')
</script>
