import { describe, expect, it } from 'vitest'
import { emptyFilters, filterPayload, filterQuery, toTimeline } from '../viewModel'

describe('conversation log view model', () => {
  it('serializes IDs and local time filters for the backend contract', () => {
    const filters = emptyFilters()
    filters.user_id = '42'
    filters.provider = 'grok'
    filters.start_at = '2026-07-17T09:30'
    const query = filterQuery(filters)
    expect(query.user_id).toBe('42')
    expect(query.provider).toBe('grok')
    expect(query.start_at).toMatch(/^2026-07-17T/)
    expect(filterPayload(filters).user_id).toBe(42)
  })

  it('builds role, tool, reasoning, and media timeline blocks', () => {
    const blocks = toTimeline([
      {
        type: 'request', sequence: 1, payload: {
          messages: [
            { role: 'system', content: 'Be precise' },
            { role: 'user', content: [
              { text: 'Inspect this image' },
              { kind: 'media', mime: 'image/png', bytes: 2048, source: 'inline' },
            ] },
          ],
        },
      },
      { type: 'delta', sequence: 2, payload: { reasoning_summary: 'Checked the evidence' } },
      { type: 'tool', sequence: 3, payload: { name: 'lookup', arguments: { id: 7 } }, truncated: true },
      { type: 'finalize', sequence: 4, payload: { status: 'partial' } },
    ])
    expect(blocks.map((block) => block.role)).toEqual(['system', 'user', 'reasoning', 'tool'])
    expect(blocks[1].media).toEqual([{ mime: 'image/png', bytes: 2048, source: 'inline', reason: '' }])
    expect(blocks[2].text).toBe('Checked the evidence')
    expect(blocks[3].truncated).toBe(true)
  })

  it('preserves top-level instructions, tool metadata, and output beside reasoning', () => {
    const blocks = toTimeline([
      { type: 'request', sequence: 1, payload: { instructions: 'System rule', tools: [{ name: 'lookup' }], messages: [{ role: 'assistant', content: '', tool_calls: [{ id: 'call_1' }] }] } },
      { type: 'delta', sequence: 2, payload: { reasoning_summary: 'Summary', output_text: 'Final answer' } },
    ])
    expect(JSON.stringify(blocks)).toContain('System rule')
    expect(JSON.stringify(blocks)).toContain('tool_calls')
    expect(blocks.some((block) => block.role === 'reasoning' && block.text === 'Summary')).toBe(true)
    expect(blocks.some((block) => block.role === 'assistant' && block.text === 'Final answer')).toBe(true)
  })

  it('aggregates a long stream into bounded semantic blocks without losing text', () => {
    const chunks = Array.from({ length: 2000 }, (_, index) => ({
      type: 'delta' as const,
      sequence: index + 1,
      payload: { choices: [{ delta: { content: String(index % 10) } }] },
    }))
    const blocks = toTimeline(chunks)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].role).toBe('assistant')
    expect(blocks[0].text).toBe(Array.from({ length: 2000 }, (_, index) => String(index % 10)).join(''))
    expect(Array.isArray(blocks[0].data)).toBe(true)
  })

  it('separates assistant text from tool metadata in a mixed tool event', () => {
    const blocks = toTimeline([{
      type: 'tool', sequence: 1, payload: {
        choices: [{ message: { role: 'assistant', content: 'I will look that up.', tool_calls: [{ id: 'call_1', function: { name: 'lookup' } }] } }],
      },
    }])
    expect(blocks.map((block) => block.role)).toEqual(['assistant', 'tool'])
    expect(blocks[0].text).toBe('I will look that up.')
    expect(JSON.stringify(blocks[1].data)).toContain('call_1')
  })

  it('preserves assistant and tool phase order while aggregating each phase', () => {
    const blocks = toTimeline([
      { type: 'delta', payload: { text: 'Before ' } },
      { type: 'tool', payload: { tool_call: { name: 'lookup' } } },
      { type: 'delta', payload: { text: 'after.' } },
    ])
    expect(blocks.map((block) => block.role)).toEqual(['assistant', 'tool', 'assistant'])
    expect(blocks.filter((block) => block.role === 'assistant').map((block) => block.text)).toEqual(['Before ', 'after.'])
  })
})
