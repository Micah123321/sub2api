import type {
  ConversationEvent,
  ConversationLogFilters,
  JSONValue,
  TimelineBlock,
  TimelineMedia,
  TimelineRole,
} from './types'

export function emptyFilters(): ConversationLogFilters {
  return {
    user_id: '', api_key_id: '', group_id: '', account_id: '', provider: '', protocol: '',
    transport: '', model: '', status: '', request_id: '', keyword: '', start_at: '', end_at: '',
  }
}

export function filterQuery(filters: ConversationLogFilters): Record<string, string> {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(filters)) {
    const normalized = dateFilterKeys.has(key) ? localDateToISO(value) : value.trim()
    if (normalized) query[key] = normalized
  }
  return query
}

export function filterPayload(filters: ConversationLogFilters): Record<string, string | number> {
  const payload: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(filterQuery(filters))) {
    payload[key] = idFilterKeys.has(key) ? Number(value) : value
  }
  return payload
}

export function toTimeline(events: ConversationEvent[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = []
  let streamed: StreamedBlocks | null = null

  const flushStreamed = () => {
    if (!streamed) return
    blocks.push(...streamed.items.map(streamedBlock))
    streamed = null
  }

  for (const event of events) {
    if (event.type === 'finalize') {
      flushStreamed()
      continue
    }
    const payload = event.payload
    const messages = event.type === 'request' ? messageItems(payload) : []
    if (messages.length) {
      flushStreamed()
      for (const message of messages) blocks.push(blockFromMessage(event, message, blocks.length))
      const remaining = withoutMessageCollections(payload)
      if (remaining !== undefined) blocks.push(...blocksFromEvent({ ...event, payload: remaining }, blocks.length))
      continue
    }
    const eventBlocks = blocksFromEvent(event, blocks.length)
    if (event.type === 'delta' || event.type === 'tool') {
      streamed ??= { items: [] }
      for (const block of eventBlocks) appendStreamedBlock(streamed, block)
      continue
    }
    flushStreamed()
    blocks.push(...eventBlocks)
  }
  flushStreamed()
  return blocks.filter((block) => block.text || block.data !== undefined || block.media.length)
}

interface StreamedBlockState extends TimelineBlock {
  chunks: JSONValue[]
}

interface StreamedBlocks {
  items: StreamedBlockState[]
}

function appendStreamedBlock(streamed: StreamedBlocks, block: TimelineBlock) {
  const current = streamed.items.at(-1)
  if (!current || current.role !== block.role) {
    streamed.items.push({
      ...block,
      chunks: block.data === undefined ? [] : [block.data],
      data: undefined,
    })
    return
  }
  current.text += block.text
  current.media.push(...block.media)
  current.truncated ||= block.truncated
  if (block.data !== undefined) current.chunks.push(block.data)
}

function streamedBlock(state: StreamedBlockState): TimelineBlock {
  const { chunks, ...block } = state
  block.data = chunks.length === 0 ? undefined : chunks.length === 1 ? chunks[0] : chunks
  return block
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const amount = value / 1024 ** index
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`
}

export function safeJSONString(value: JSONValue | undefined): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

export function cloneFilters(filters: ConversationLogFilters): ConversationLogFilters {
  return { ...filters }
}

function blockFromMessage(event: ConversationEvent, value: Record<string, JSONValue>, index: number): TimelineBlock {
  const role = normalizeRole(stringValue(value.role))
  const content = value.content ?? value.parts ?? value.text
  return {
    id: `${event.sequence ?? index}-${index}`,
    role,
    text: extractText(content),
    data: value,
    media: extractMedia(content),
    timestamp: event.timestamp,
    truncated: Boolean(event.truncated),
  }
}

function blocksFromEvent(event: ConversationEvent, index: number): TimelineBlock[] {
  const payload = event.payload
  const reasoning = findValue(payload, ['reasoning_summary', 'summary_text'])
  const textSource = findValue(payload, ['delta', 'text', 'content', 'output_text', 'message'])
  const blocks: TimelineBlock[] = []
  if (reasoning !== undefined) {
    blocks.push({
      id: `${event.sequence ?? index}-${index}-reasoning`, role: 'reasoning', text: extractText(reasoning),
      data: reasoning, media: [], timestamp: event.timestamp, truncated: Boolean(event.truncated),
    })
  }
  const contentData = reasoning === undefined ? payload : withoutKeys(payload, ['reasoning_summary', 'summary_text'])
  if (contentData === undefined) return blocks
  if (event.type === 'tool') {
    const assistantText = extractAssistantText(contentData)
    if (assistantText) {
      blocks.push({
        id: `${event.sequence ?? index}-${index}-assistant`, role: 'assistant', text: assistantText,
        media: [], timestamp: event.timestamp, truncated: Boolean(event.truncated),
      })
    }
  }
  const role: TimelineRole = event.type === 'tool' ? 'tool' : event.type === 'delta' ? 'assistant' : 'event'
  blocks.push({
    id: `${event.sequence ?? index}-${index}-content`, role,
    text: event.type === 'tool' ? '' : extractText(textSource), data: contentData,
    media: extractMedia(contentData), timestamp: event.timestamp, truncated: Boolean(event.truncated),
  })
  return blocks
}

function extractAssistantText(value: JSONValue | undefined): string {
  if (Array.isArray(value)) return value.map(extractAssistantText).filter(Boolean).join('')
  if (!isObject(value)) return ''
  if (stringValue(value.role) === 'assistant') {
    return extractText(value.content ?? value.parts ?? value.text)
  }
  if (isObject(value.delta) && typeof value.delta.content === 'string') {
    return value.delta.content
  }
  return Object.values(value).map(extractAssistantText).find(Boolean) || ''
}

function messageItems(value: JSONValue | undefined): Array<Record<string, JSONValue>> {
  if (!isObject(value)) return []
  for (const key of ['messages', 'contents', 'input']) {
    const items = value[key]
    if (Array.isArray(items)) return items.filter(isObject)
  }
  return 'role' in value ? [value] : []
}

function withoutMessageCollections(value: JSONValue | undefined): JSONValue | undefined {
  return withoutKeys(value, ['messages', 'contents', 'input'])
}

function withoutKeys(value: JSONValue | undefined, omitted: string[]): JSONValue | undefined {
  if (!isObject(value)) return undefined
  const result: Record<string, JSONValue> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!omitted.includes(key)) result[key] = item
  }
  return Object.keys(result).length ? result : undefined
}

function extractText(value: JSONValue | undefined): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join('\n')
  if (!isObject(value)) return ''
  for (const key of ['text', 'content', 'delta', 'output_text', 'message']) {
    const text = extractText(value[key])
    if (text) return text
  }
  return ''
}

function extractMedia(value: JSONValue | undefined, result: TimelineMedia[] = []): TimelineMedia[] {
  if (Array.isArray(value)) {
    value.forEach((item) => extractMedia(item, result))
  } else if (isObject(value)) {
    const kind = stringValue(value.kind || value.type)
    const reason = stringValue(value.reason)
    if (kind === 'media' || reason.includes('media') || reason.includes('binary')) {
      result.push({
        mime: stringValue(value.mime || value.mime_type || value.media_type) || 'application/octet-stream',
        bytes: numberValue(value.bytes || value.size), source: stringValue(value.source), reason,
      })
    } else {
      Object.values(value).forEach((item) => extractMedia(item, result))
    }
  }
  return result
}

function findValue(value: JSONValue | undefined, keys: string[]): JSONValue | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValue(item, keys)
      if (found !== undefined) return found
    }
  } else if (isObject(value)) {
    for (const key of keys) if (value[key] !== undefined) return value[key]
    for (const item of Object.values(value)) {
      const found = findValue(item, keys)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function normalizeRole(value: string): TimelineRole {
  return ['system', 'developer', 'user', 'assistant', 'tool'].includes(value) ? value as TimelineRole : 'event'
}

function isObject(value: JSONValue | undefined): value is Record<string, JSONValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: JSONValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function localDateToISO(value: string): string {
  if (!value.trim()) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

const idFilterKeys = new Set(['user_id', 'api_key_id', 'group_id', 'account_id'])
const dateFilterKeys = new Set(['start_at', 'end_at'])

export function conversationLabels(english: boolean): Record<string, string> {
  return english ? {
    title: 'Conversation logs', refresh: 'Refresh', delete: 'Delete', search: 'Search', keyword: 'Content or identity',
    provider: 'Provider', protocol: 'Protocol', transport: 'Transport', status: 'Status', all: 'All', more: 'More filters',
    request: 'Request ID', model: 'Model', user: 'User ID', group: 'Group ID', account: 'Account ID', start: 'Start', end: 'End', reset: 'Reset', apply: 'Apply',
    time: 'Time', identity: 'Identity', preview: 'Preview', route: 'Route', latency: 'Latency', noPreview: 'No preview',
    empty: 'No conversation logs', noContent: 'No content was recorded for this turn.', retry: 'Retry', select: 'Select a conversation', detailError: 'Conversation unavailable',
    unknownModel: 'Unknown model', copy: 'Copy request ID', messages: 'Messages / tools', expires: 'Expires',
    truncated: 'This turn is partial or truncated.', toolData: 'Tool data', reasoningData: 'Reasoning summary', raw: 'Raw event', partial: 'Partial',
    role_system: 'System', role_developer: 'Developer', role_user: 'User', role_assistant: 'Assistant', role_tool: 'Tool',
    role_reasoning: 'Reasoning', role_event: 'Event', copied: 'Request ID copied', copyFailed: 'Copy failed', runtime: 'Writer', queued: 'Queued',
    written: 'Written', failed: 'Write failures', decode: 'Decode failures', disabled: 'Conversation logging is unavailable',
    deleteTitle: 'Delete conversation logs', matched: 'Matched records:', until: 'Confirmation expires:',
    deletePrompt: 'Choose an explicit time range before previewing deletion.', cancel: 'Cancel', loading: 'Loading…',
    previewDelete: 'Preview deletion', confirmDelete: 'Delete records', deleting: 'Deleting…', deleted: 'Records deleted:',
    invalidRange: 'The end time must be later than the start time.', cleanupFailed: 'Unable to delete conversation logs.',
    status_completed: 'Completed', status_failed: 'Failed', status_partial: 'Partial', status_blocked: 'Blocked', status_cancelled: 'Cancelled',
  } : {
    title: '对话日志', refresh: '刷新', delete: '删除', search: '搜索', keyword: '内容或身份', provider: '提供商',
    protocol: '协议', transport: '传输', status: '状态', all: '全部', more: '更多筛选', request: '请求 ID',
    model: '模型', user: '用户 ID', group: '分组 ID', account: '账号 ID', start: '开始时间', end: '结束时间', reset: '重置', apply: '应用', time: '时间',
    identity: '身份', preview: '预览', route: '路由', latency: '耗时', noPreview: '无预览', empty: '暂无对话日志', noContent: '本轮未记录到可显示的内容。',
    retry: '重试', select: '选择一条对话', detailError: '对话内容不可用', unknownModel: '未知模型', copy: '复制请求 ID',
    messages: '消息 / 工具', expires: '到期时间', truncated: '本轮内容不完整或已截断。', toolData: '工具数据', reasoningData: '推理摘要', raw: '原始事件',
    partial: '内容不完整', role_system: '系统', role_developer: '开发者', role_user: '用户', role_assistant: '助手',
    role_tool: '工具', role_reasoning: '推理摘要', role_event: '事件', copied: '请求 ID 已复制', copyFailed: '复制失败', runtime: '写入器',
    queued: '排队', written: '已写入', failed: '写入失败', decode: '解码失败', disabled: '对话日志当前不可用',
    deleteTitle: '删除对话日志', matched: '匹配记录：', until: '确认有效至：', deletePrompt: '请先选择明确的时间范围，再预览删除。',
    cancel: '取消', loading: '加载中…', previewDelete: '预览删除', confirmDelete: '删除记录', deleting: '删除中…',
    deleted: '已删除记录：', invalidRange: '结束时间必须晚于开始时间。', cleanupFailed: '删除对话日志失败。',
    status_completed: '已完成', status_failed: '失败', status_partial: '部分完成', status_blocked: '已拦截', status_cancelled: '已取消',
  }
}
