import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import PlatformTypeBadge from '../PlatformTypeBadge.vue'

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

const mountBadge = (planType: string) =>
  mount(PlatformTypeBadge, {
    props: { platform: 'openai', type: 'oauth', planType },
  })

describe('PlatformTypeBadge OpenAI plan labels', () => {
  // The account list filter offers k12/team/plus/pro/free; a plan the filter can
  // select but the badge renders raw (e.g. lowercase "k12") reads as a data glitch.
  it('renders every filterable plan with its filter-facing label', () => {
    const expected: Array<[string, string]> = [
      ['k12', 'K12'],
      ['team', 'Team'],
      ['plus', 'Plus'],
      ['pro', 'Pro'],
      ['free', 'Free'],
    ]

    for (const [stored, label] of expected) {
      expect(mountBadge(stored).text()).toContain(label)
    }
  })

  it('normalizes casing and separators for stored plan values', () => {
    expect(mountBadge('K12').text()).toContain('K12')
    expect(mountBadge('K-12').text()).toContain('K12')
    expect(mountBadge('chatgptpro').text()).toContain('Pro')
    expect(mountBadge('chatgpt_pro').text()).toContain('Pro')
  })

  it('falls back to the raw value for plans outside the known set', () => {
    expect(mountBadge('self_serve_business_usage_based').text())
      .toContain('self_serve_business_usage_based')
  })
})
