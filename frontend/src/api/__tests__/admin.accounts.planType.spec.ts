import { beforeEach, describe, expect, it, vi } from 'vitest'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/api/client', () => ({ apiClient: { get } }))

import { exportData, list, listWithEtag } from '@/api/admin/accounts'

describe('admin account plan type filters', () => {
  beforeEach(() => {
    get.mockReset()
  })

  it('passes plan_type to list and ETag list requests', async () => {
    get
      .mockResolvedValueOnce({ data: { items: [], total: 0 } })
      .mockResolvedValueOnce({ status: 200, headers: {}, data: { items: [], total: 0 } })

    await list(2, 50, { platform: 'openai', plan_type: 'team' })
    await listWithEtag(2, 50, { platform: 'openai', plan_type: 'team' }, { etag: 'accounts-v1' })

    expect(get.mock.calls[0]).toEqual([
      '/admin/accounts',
      expect.objectContaining({ params: expect.objectContaining({ page: 2, page_size: 50, plan_type: 'team' }) })
    ])
    expect(get.mock.calls[1]).toEqual([
      '/admin/accounts',
      expect.objectContaining({
        params: expect.objectContaining({ page: 2, page_size: 50, plan_type: 'team' }),
        headers: { 'If-None-Match': 'accounts-v1' }
      })
    ])
  })

  it('passes plan_type to filtered exports', async () => {
    get.mockResolvedValueOnce({ data: { accounts: [] } })

    await exportData({ filters: { platform: 'openai', plan_type: 'k12' } })

    expect(get).toHaveBeenCalledWith('/admin/accounts/data', {
      params: { platform: 'openai', plan_type: 'k12' }
    })
  })
})
