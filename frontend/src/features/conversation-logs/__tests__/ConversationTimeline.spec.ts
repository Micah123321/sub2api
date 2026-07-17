import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ConversationTimeline from '../components/ConversationTimeline.vue'
import { conversationLabels } from '../viewModel'
import type { ConversationLogDetail } from '../types'

const detail: ConversationLogDetail = {
  id: 1, request_id: 'req-1', conversation_id: '', turn_index: 0,
  username_snapshot: 'alice', user_email_snapshot: '', api_key_name_snapshot: 'key', group_name_snapshot: 'main', account_name_snapshot: '',
  provider: 'openai', endpoint: '/v1/responses', protocol: 'openai_responses', transport: 'sse', model: 'gpt-5',
  status: 'partial', status_code: 200, latency_ms: 120, message_count: 2, tool_call_count: 1, has_reasoning_summary: true,
  preview: 'hello', truncated: true, started_at: '2026-07-17T00:00:00Z', completed_at: '2026-07-17T00:00:01Z',
  expires_at: '2026-08-17T00:00:01Z', created_at: '2026-07-17T00:00:01Z',
  events: [
    { type: 'request', payload: { messages: [{ role: 'user', content: 'hello' }] } },
    { type: 'tool', payload: { name: 'search', arguments: { q: 'evidence' } } },
  ],
}

describe('ConversationTimeline', () => {
  it('renders forensic roles, tool data, and truncation state', () => {
    const wrapper = mount(ConversationTimeline, {
      props: { detail, loading: false, error: '', labels: conversationLabels(false) },
      global: { stubs: { Icon: true, Skeleton: true, EmptyState: true } },
    })
    expect(wrapper.text()).toContain('用户')
    expect(wrapper.text()).toContain('hello')
    expect(wrapper.text()).toContain('工具数据')
    expect(wrapper.text()).toContain('本轮内容不完整或已截断')
  })

  it('mounts raw JSON only after the disclosure is opened', async () => {
    const wrapper = mount(ConversationTimeline, {
      props: { detail, loading: false, error: '', labels: conversationLabels(false) },
      global: { stubs: { Icon: true, Skeleton: true, EmptyState: true } },
    })
    const disclosure = wrapper.get('details.group\\/data')
    expect(wrapper.find('pre').exists()).toBe(false)
    ;(disclosure.element as HTMLDetailsElement).open = true
    await disclosure.trigger('toggle')
    await nextTick()
    expect(wrapper.find('pre').exists()).toBe(true)
  })
})
