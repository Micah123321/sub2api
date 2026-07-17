<template>
  <AppLayout>
    <div class="mx-auto max-w-[1680px] pb-8">
      <header class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-semibold text-gray-950 dark:text-white">{{ labels.title }}</h1>
        <div class="flex items-center gap-2">
          <div v-if="runtime" class="hidden items-center gap-3 border-r border-gray-200 pr-3 text-xs text-gray-500 sm:flex dark:border-dark-700">
            <span><b class="text-gray-800 dark:text-dark-100">{{ runtime.queue_depth }}</b> {{ labels.queued }}</span>
            <span><b class="text-gray-800 dark:text-dark-100">{{ runtime.written }}</b> {{ labels.written }}</span>
            <span v-if="runtime.write_failed" class="text-red-600">{{ runtime.write_failed }} {{ labels.failed }}</span>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" :disabled="loading.list" @click="refresh"><Icon name="refresh" size="sm" class="mr-1.5" :class="loading.list ? 'animate-spin' : ''" />{{ labels.refresh }}</button>
        </div>
      </header>

      <div v-if="runtimeError || runtime?.queue_capacity === 0" role="status" class="mb-4 flex items-center gap-2 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><Icon name="exclamationTriangle" size="sm" />{{ runtimeError || labels.disabled }}</div>
      <div v-else-if="runtime?.last_error" role="status" class="mb-4 flex items-center justify-between gap-3 border-l-2 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300"><span class="truncate">{{ runtime.last_error }}</span><span class="shrink-0">{{ labels.decode }} {{ runtime.decode_failed }}</span></div>

      <TablePageLayout class="conversation-layout">
        <template #filters><div class="card p-4"><ConversationLogFilters v-model="filters" :labels="labels" @apply="applyFilters" @reset="resetFilters" @delete="openDelete" /></div></template>
        <template #table><ConversationLogList :items="page.items" :selected-id="selectedId" :loading="loading.list" :error="listError" :labels="labels" @select="selectLog" @retry="loadList" /></template>
        <template #pagination><Pagination :total="page.total" :page="page.page" :page-size="page.page_size" :show-jump="true" @update:page="changePage" @update:page-size="changePageSize" /></template>
      </TablePageLayout>

      <div class="mt-5 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-dark-700 dark:bg-dark-800">
        <ConversationTimeline :detail="detail" :loading="loading.detail" :error="detailError" :labels="labels" @retry="retryDetail" @copied="appStore.showSuccess(labels.copied)" @copy-failed="appStore.showError(labels.copyFailed)" />
      </div>
    </div>

    <DeleteLogsDialog :show="deleteOpen" :filters="deleteFilters" :preview="deletePreview" :busy="loading.delete" :error="deleteError" :labels="labels" @close="closeDelete" @preview="runDeletePreview" @confirm="confirmDelete" @criteria-change="clearDeletePreview" />
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import TablePageLayout from '@/components/layout/TablePageLayout.vue'
import Pagination from '@/components/common/Pagination.vue'
import Icon from '@/components/icons/Icon.vue'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage } from '@/utils/apiError'
import ConversationLogFilters from './components/ConversationLogFilters.vue'
import ConversationLogList from './components/ConversationLogList.vue'
import ConversationTimeline from './components/ConversationTimeline.vue'
import DeleteLogsDialog from './components/DeleteLogsDialog.vue'
import conversationLogsAPI from './api'
import type { ConversationDeletePreview, ConversationLogDetail, ConversationLogFilters as Filters, ConversationLogPage, ConversationLogRuntime } from './types'
import { cloneFilters, conversationLabels, emptyFilters } from './viewModel'

const { locale } = useI18n()
const appStore = useAppStore()
const labels = computed(() => conversationLabels(locale.value.toLowerCase().startsWith('en')))
const filters = ref<Filters>(emptyFilters())
const appliedFilters = ref<Filters>(emptyFilters())
const deleteFilters = ref<Filters>(emptyFilters())
const page = reactive<ConversationLogPage>({ items: [], total: 0, page: 1, page_size: 20, pages: 0 })
const runtime = ref<ConversationLogRuntime | null>(null)
const detail = ref<ConversationLogDetail | null>(null)
const selectedId = ref<number | null>(null)
const deletePreview = ref<ConversationDeletePreview | null>(null)
const deleteOpen = ref(false)
const listError = ref('')
const detailError = ref('')
const runtimeError = ref('')
const deleteError = ref('')
const loading = reactive({ list: false, detail: false, runtime: false, delete: false })
let detailRequest = 0
let listRequest = 0

const errorText = (error: unknown, fallback: string) => extractApiErrorMessage(error, fallback)

async function loadList() {
  const request = ++listRequest
  loading.list = true
  listError.value = ''
  try {
    const result = await conversationLogsAPI.list(appliedFilters.value, page.page, page.page_size)
    if (request !== listRequest) return
    Object.assign(page, result)
    if (selectedId.value && !page.items.some((item) => item.id === selectedId.value)) clearDetail()
  } catch (error) { if (request === listRequest) listError.value = errorText(error, labels.value.detailError) }
  finally { if (request === listRequest) loading.list = false }
}

async function loadRuntime() {
  loading.runtime = true
  runtimeError.value = ''
  try { runtime.value = await conversationLogsAPI.runtime() }
  catch (error) { runtimeError.value = errorText(error, labels.value.disabled) }
  finally { loading.runtime = false }
}

async function selectLog(id: number) {
  selectedId.value = id
  detail.value = null
  detailError.value = ''
  loading.detail = true
  const request = ++detailRequest
  try {
    const result = await conversationLogsAPI.detail(id)
    if (request === detailRequest) detail.value = result
  } catch (error) {
    if (request === detailRequest) detailError.value = errorText(error, labels.value.detailError)
  } finally { if (request === detailRequest) loading.detail = false }
}

function clearDetail() { detailRequest++; selectedId.value = null; detail.value = null; detailError.value = ''; loading.detail = false }
function retryDetail() { if (selectedId.value) void selectLog(selectedId.value) }
function applyFilters() { appliedFilters.value = cloneFilters(filters.value); page.page = 1; clearDetail(); void loadList() }
function resetFilters() { filters.value = emptyFilters(); appliedFilters.value = emptyFilters(); page.page = 1; clearDetail(); void loadList() }
function changePage(value: number) { page.page = value; clearDetail(); void loadList() }
function changePageSize(value: number) { page.page_size = value; page.page = 1; clearDetail(); void loadList() }
function refresh() { void Promise.allSettled([loadList(), loadRuntime()]); if (selectedId.value) void selectLog(selectedId.value) }
function openDelete() { deleteFilters.value = cloneFilters(appliedFilters.value); deletePreview.value = null; deleteError.value = ''; deleteOpen.value = true }
function clearDeletePreview() { deletePreview.value = null; deleteError.value = '' }
function closeDelete() { deleteOpen.value = false; clearDeletePreview() }

async function runDeletePreview(value: Filters) {
  loading.delete = true
  deleteError.value = ''
  deleteFilters.value = cloneFilters(value)
  try { deletePreview.value = await conversationLogsAPI.previewDelete(value) }
  catch (error) { deleteError.value = errorText(error, labels.value.invalidRange) }
  finally { loading.delete = false }
}

async function confirmDelete() {
  if (!deletePreview.value) return
  loading.delete = true
  deleteError.value = ''
  try {
    const result = await conversationLogsAPI.deleteByFilter(deleteFilters.value, deletePreview.value)
    appStore.showSuccess(`${labels.value.deleted} ${result.deleted}`)
    closeDelete(); clearDetail(); await Promise.allSettled([loadList(), loadRuntime()])
  } catch (error) { deleteError.value = errorText(error, labels.value.cleanupFailed); deletePreview.value = null }
  finally { loading.delete = false }
}

onMounted(() => { void Promise.allSettled([loadList(), loadRuntime()]) })
onBeforeUnmount(() => { detailRequest++; listRequest++; detail.value = null })
</script>

<style scoped>
:deep(.conversation-layout) { height: auto; gap: 1rem; }
:deep(.conversation-layout .layout-section-scrollable) { min-height: 240px; max-height: 420px; }
:deep(.conversation-layout .table-scroll-container) { border-radius: 0.5rem; }
@media (max-width: 767px) { :deep(.conversation-layout .layout-section-scrollable) { max-height: none; } }
</style>
