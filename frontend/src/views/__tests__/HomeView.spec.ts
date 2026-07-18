import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import HomeView from '../HomeView.vue'

const { appStore, authStore, clipboardWriteText } = vi.hoisted(() => ({
  appStore: {
    cachedPublicSettings: {
      site_name: 'Sub2API',
      site_logo: '',
      site_subtitle: 'AI API Gateway Platform',
      api_base_url: 'https://api.example.com/v1/',
      doc_url: 'https://docs.example.com',
      home_content: ''
    },
    siteName: 'Sub2API',
    siteLogo: '',
    apiBaseUrl: 'https://api.example.com/v1/',
    docUrl: 'https://docs.example.com',
    publicSettingsLoaded: true,
    fetchPublicSettings: vi.fn()
  },
  authStore: {
    isAuthenticated: false,
    isAdmin: false,
    user: null,
    checkAuth: vi.fn()
  },
  clipboardWriteText: vi.fn()
}))

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('@/stores', () => ({
  useAppStore: () => appStore,
  useAuthStore: () => authStore
}))

function mountHome(): VueWrapper {
  return mount(HomeView, {
    global: {
      stubs: {
        Icon: { template: '<span data-icon />' },
        LocaleSwitcher: { template: '<span data-locale-switcher />' },
        ThemeSwitcher: { template: '<span data-theme-switcher />' },
        RouterLink: { template: '<a><slot /></a>' }
      }
    }
  })
}

describe('HomeView documentation center', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    appStore.cachedPublicSettings.api_base_url = 'https://api.example.com/v1/'
    appStore.cachedPublicSettings.doc_url = 'https://docs.example.com'
    appStore.apiBaseUrl = 'https://api.example.com/v1/'
    appStore.docUrl = 'https://docs.example.com'
    clipboardWriteText.mockReset().mockResolvedValue(undefined)
    authStore.checkAuth.mockReset()
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false })
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText }
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('renders a normalized API endpoint and copies it successfully', async () => {
    wrapper = mountHome()

    expect(wrapper.find('[data-testid="home-docs"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="api-endpoint"]').text()).toBe('https://api.example.com/v1')

    await wrapper.get('[data-testid="copy-api-endpoint"]').trigger('click')
    await flushPromises()

    expect(clipboardWriteText).toHaveBeenCalledWith('https://api.example.com/v1')
    expect(wrapper.get('[data-testid="copy-api-endpoint"]').text()).toContain('home.documentation.copied')
  })

  it('falls back to the current site origin when no API base URL is configured', () => {
    appStore.cachedPublicSettings.api_base_url = ''
    appStore.apiBaseUrl = ''
    wrapper = mountHome()

    expect(wrapper.get('[data-testid="api-endpoint"]').text()).toBe(`${window.location.origin}/v1`)
  })

  it('shows a visible failure state when copying is rejected', async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error('clipboard unavailable'))
    wrapper = mountHome()

    await wrapper.get('[data-testid="copy-api-endpoint"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="copy-api-endpoint"]').text()).toContain('home.documentation.copyFailed')
  })

  it('links every document category to the configured documentation URL', () => {
    wrapper = mountHome()

    const cards = wrapper.findAll('[data-testid="documentation-card"]')
    expect(cards).toHaveLength(4)
    for (const card of cards) {
      expect(card.element.tagName).toBe('A')
      expect(card.attributes('href')).toBe(new URL('https://docs.example.com').href)
      expect(card.attributes('target')).toBe('_blank')
      expect(card.attributes('rel')).toBe('noopener noreferrer')
    }
  })

  it('keeps document categories as non-interactive summaries without a documentation URL', () => {
    appStore.cachedPublicSettings.doc_url = '   '
    appStore.docUrl = '   '
    wrapper = mountHome()

    const cards = wrapper.findAll('[data-testid="documentation-card"]')
    expect(cards).toHaveLength(4)
    for (const card of cards) {
      expect(card.element.tagName).toBe('ARTICLE')
      expect(card.attributes('href')).toBeUndefined()
    }
  })
})
