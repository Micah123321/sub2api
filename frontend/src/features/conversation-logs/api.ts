import { apiClient } from '@/api/client'
import type {
  ConversationDeletePreview,
  ConversationDeleteResult,
  ConversationLogDetail,
  ConversationLogFilters,
  ConversationLogPage,
  ConversationLogRuntime,
} from './types'
import { filterPayload, filterQuery } from './viewModel'

const basePath = '/admin/conversation-logs'

export async function listConversationLogs(filters: ConversationLogFilters, page: number, pageSize: number) {
  const { data } = await apiClient.get<ConversationLogPage>(basePath, {
    params: { page, page_size: pageSize, ...filterQuery(filters) },
  })
  return data
}

export async function getConversationLog(id: number) {
  const { data } = await apiClient.get<ConversationLogDetail>(`${basePath}/${id}`)
  return data
}

export async function getConversationLogRuntime() {
  const { data } = await apiClient.get<ConversationLogRuntime>(`${basePath}/runtime`)
  return data
}

export async function previewConversationDelete(filters: ConversationLogFilters) {
  const { data } = await apiClient.post<ConversationDeletePreview>(
    `${basePath}/delete-preview`,
    filterPayload(filters),
  )
  return data
}

export async function deleteConversations(filters: ConversationLogFilters, preview: ConversationDeletePreview) {
  const { data } = await apiClient.post<ConversationDeleteResult>(`${basePath}/delete-by-filter`, {
    filter: filterPayload(filters),
    snapshot_max_id: preview.snapshot_max_id,
    filter_hash: preview.filter_hash,
    confirmation_token: preview.confirmation_token,
    confirm: true,
  })
  return data
}

export default {
  list: listConversationLogs,
  detail: getConversationLog,
  runtime: getConversationLogRuntime,
  previewDelete: previewConversationDelete,
  deleteByFilter: deleteConversations,
}
