import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyFilters } from '../viewModel'

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/api/client', () => ({ apiClient: client }))

import api from '../api'

describe('conversation logs API', () => {
  beforeEach(() => Object.values(client).forEach((mock) => mock.mockReset()))

  it('uses metadata list and detail endpoints without putting content in query state', async () => {
    client.get.mockResolvedValue({ data: { items: [], total: 0 } })
    const filters = emptyFilters()
    filters.request_id = 'req-1'
    await api.list(filters, 2, 20)
    expect(client.get).toHaveBeenCalledWith('/admin/conversation-logs', {
      params: { page: 2, page_size: 20, request_id: 'req-1' },
    })
    client.get.mockResolvedValue({ data: { id: 9, events: [] } })
    await api.detail(9)
    expect(client.get).toHaveBeenCalledWith('/admin/conversation-logs/9')
  })

  it('passes the signed preview through the destructive request', async () => {
    client.post.mockResolvedValue({ data: { deleted: 3 } })
    const filters = emptyFilters()
    filters.start_at = '2026-07-16T00:00'
    filters.end_at = '2026-07-17T00:00'
    await api.deleteByFilter(filters, {
      matched_count: 3, snapshot_max_id: 18, filter_hash: 'hash', confirmation_token: 'token', expires_at: '2026-07-17T00:05:00Z',
    })
    expect(client.post).toHaveBeenCalledWith('/admin/conversation-logs/delete-by-filter', expect.objectContaining({
      snapshot_max_id: 18, filter_hash: 'hash', confirmation_token: 'token', confirm: true,
    }))
  })
})
