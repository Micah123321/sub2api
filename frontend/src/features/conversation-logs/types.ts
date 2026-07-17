export type ConversationStatus = 'completed' | 'failed' | 'partial' | 'blocked' | 'cancelled'
export type ConversationEventType = 'request' | 'delta' | 'tool' | 'finalize'
export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue }

export interface ConversationLogRecord {
  id: number
  request_id: string
  conversation_id: string
  turn_index: number
  user_id?: number
  username_snapshot: string
  user_email_snapshot: string
  api_key_id?: number
  api_key_name_snapshot: string
  group_id?: number
  group_name_snapshot: string
  account_id?: number
  account_name_snapshot: string
  provider: string
  endpoint: string
  protocol: string
  transport: 'http' | 'sse' | 'ws' | string
  model: string
  status: ConversationStatus | string
  status_code: number
  latency_ms: number
  message_count: number
  tool_call_count: number
  has_reasoning_summary: boolean
  preview: string
  truncated: boolean
  started_at: string
  completed_at: string
  expires_at: string
  created_at: string
}

export interface ConversationEvent {
  type: ConversationEventType
  sequence?: number
  timestamp?: number
  payload?: JSONValue
  truncated?: boolean
}

export interface ConversationLogDetail extends ConversationLogRecord {
  events: ConversationEvent[]
}

export interface ConversationLogPage {
  items: ConversationLogRecord[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface ConversationLogRuntime {
  queue_depth: number
  queue_capacity: number
  written: number
  write_failed: number
  dropped: number
  decode_failed: number
  last_error: string
}

export interface ConversationLogFilters {
  user_id: string
  api_key_id: string
  group_id: string
  account_id: string
  provider: string
  protocol: string
  transport: string
  model: string
  status: string
  request_id: string
  keyword: string
  start_at: string
  end_at: string
}

export interface ConversationDeletePreview {
  matched_count: number
  snapshot_max_id: number
  filter_hash: string
  confirmation_token: string
  expires_at: string
}

export interface ConversationDeleteResult {
  deleted: number
}

export type TimelineRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool' | 'reasoning' | 'event'

export interface TimelineMedia {
  mime: string
  bytes?: number
  source?: string
  reason?: string
}

export interface TimelineBlock {
  id: string
  role: TimelineRole
  text: string
  data?: JSONValue
  media: TimelineMedia[]
  timestamp?: number
  truncated: boolean
}
