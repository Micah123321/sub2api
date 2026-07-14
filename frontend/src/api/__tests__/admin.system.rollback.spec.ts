import { beforeEach, describe, expect, it, vi } from 'vitest'

const { get, post, put } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}))

vi.mock('../client', () => ({
  apiClient: {
    get,
    post,
    put,
  },
}))

import {
  getRollbackVersions,
  rollback,
  getUpdateChannel,
  setUpdateChannel,
  type RollbackVersionInfo
} from '@/api/admin/system'

describe('admin system rollback API', () => {
  beforeEach(() => {
    get.mockReset()
    post.mockReset()
    put.mockReset()
  })

  it('getRollbackVersions fetches the rollback version list', async () => {
    const versions: RollbackVersionInfo[] = [
      {
        version: '0.1.146',
        published_at: '2026-07-07T00:00:00Z',
        html_url: 'https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.146'
      }
    ]
    get.mockResolvedValue({ data: { versions } })

    const result = await getRollbackVersions()

    expect(get).toHaveBeenCalledWith('/admin/system/rollback-versions')
    expect(result.versions).toEqual(versions)
  })

  it('rollback posts the target version in the request body', async () => {
    post.mockResolvedValue({ data: { message: 'ok', need_restart: true } })

    const result = await rollback('0.1.146')

    expect(post).toHaveBeenCalledWith('/admin/system/rollback', { version: '0.1.146' })
    expect(result.need_restart).toBe(true)
  })

  it('rollback without a version posts no body (legacy backup rollback)', async () => {
    post.mockResolvedValue({ data: { message: 'ok', need_restart: true } })

    await rollback()

    expect(post).toHaveBeenCalledWith('/admin/system/rollback', undefined)
  })
})

describe('admin system update channel API', () => {
  beforeEach(() => {
    get.mockReset()
    put.mockReset()
  })

  it('getUpdateChannel fetches the current channel', async () => {
    get.mockResolvedValue({ data: { channel: 'custom' } })

    const result = await getUpdateChannel()

    expect(get).toHaveBeenCalledWith('/admin/system/update-channel')
    expect(result.channel).toBe('custom')
  })

  it('setUpdateChannel puts the channel in the request body', async () => {
    put.mockResolvedValue({ data: { channel: 'official' } })

    const result = await setUpdateChannel('official')

    expect(put).toHaveBeenCalledWith('/admin/system/update-channel', { channel: 'official' })
    expect(result.channel).toBe('official')
  })
})
