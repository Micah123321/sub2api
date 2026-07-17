<template>
  <form class="space-y-3" @submit.prevent="emit('apply')">
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      <label class="filter-field xl:col-span-2">
        <span>{{ labels.search }}</span>
        <div class="relative">
          <Icon name="search" size="sm" class="pointer-events-none absolute left-3 top-2.5 text-gray-400" />
          <input v-model="model.keyword" class="input h-9 pl-9" :placeholder="labels.keyword" />
        </div>
      </label>
      <label class="filter-field">
        <span>{{ labels.provider }}</span>
        <select v-model="model.provider" class="input h-9"><option value="">{{ labels.all }}</option><option v-for="value in providers" :key="value" :value="value">{{ value }}</option></select>
      </label>
      <label class="filter-field">
        <span>{{ labels.protocol }}</span>
        <select v-model="model.protocol" class="input h-9"><option value="">{{ labels.all }}</option><option value="anthropic_messages">Anthropic Messages</option><option value="openai_chat_completions">Chat Completions</option><option value="openai_responses">Responses</option></select>
      </label>
      <label class="filter-field">
        <span>{{ labels.transport }}</span>
        <select v-model="model.transport" class="input h-9"><option value="">{{ labels.all }}</option><option value="http">HTTP</option><option value="sse">SSE</option><option value="ws">WS</option></select>
      </label>
      <label class="filter-field">
        <span>{{ labels.status }}</span>
        <select v-model="model.status" class="input h-9"><option value="">{{ labels.all }}</option><option v-for="value in statuses" :key="value" :value="value">{{ statusLabel(value) }}</option></select>
      </label>
    </div>
    <details class="group">
      <summary class="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 dark:text-dark-300 dark:hover:text-white">
        <Icon name="chevronRight" size="xs" class="transition-transform group-open:rotate-90" />{{ labels.more }}
      </summary>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <label class="filter-field"><span>{{ labels.request }}</span><input v-model="model.request_id" class="input h-9 font-mono text-xs" /></label>
        <label class="filter-field"><span>{{ labels.model }}</span><input v-model="model.model" class="input h-9" /></label>
        <label class="filter-field"><span>{{ labels.user }}</span><input v-model="model.user_id" type="number" min="1" class="input h-9" /></label>
        <label class="filter-field"><span>API Key ID</span><input v-model="model.api_key_id" type="number" min="1" class="input h-9" /></label>
        <label class="filter-field"><span>{{ labels.group }}</span><input v-model="model.group_id" type="number" min="1" class="input h-9" /></label>
        <label class="filter-field"><span>{{ labels.account }}</span><input v-model="model.account_id" type="number" min="1" class="input h-9" /></label>
        <label class="filter-field"><span>{{ labels.start }}</span><input v-model="model.start_at" type="datetime-local" class="input h-9" /></label>
        <label class="filter-field"><span>{{ labels.end }}</span><input v-model="model.end_at" type="datetime-local" class="input h-9" /></label>
      </div>
    </details>
    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-dark-700">
      <button type="button" class="btn btn-ghost btn-sm" @click="emit('reset')">{{ labels.reset }}</button>
      <div class="flex items-center gap-2">
        <button type="button" class="btn btn-danger btn-sm" @click="emit('delete')"><Icon name="trash" size="sm" class="mr-1.5" />{{ labels.delete }}</button>
        <button type="submit" class="btn btn-primary btn-sm"><Icon name="filter" size="sm" class="mr-1.5" />{{ labels.apply }}</button>
      </div>
    </div>
  </form>
</template>

<script setup lang="ts">
import Icon from '@/components/icons/Icon.vue'
import type { ConversationLogFilters } from '../types'

const props = defineProps<{ labels: Record<string, string> }>()
const model = defineModel<ConversationLogFilters>({ required: true })
const emit = defineEmits<{ apply: []; reset: []; delete: [] }>()
const providers = ['anthropic', 'openai', 'gemini', 'grok', 'antigravity']
const statuses = ['completed', 'failed', 'partial', 'blocked', 'cancelled']
const statusLabel = (value: string) => props.labels[`status_${value}`] || value
</script>

<style scoped>
.filter-field { @apply flex min-w-0 flex-col gap-1 text-xs font-medium text-gray-500 dark:text-dark-300; }
</style>
