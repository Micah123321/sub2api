import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  COLOR_MODE_STORAGE_KEY,
  UI_THEME_STORAGE_KEY,
  initTheme,
  setColorMode,
  toggleColorMode,
  setUiTheme,
  cycleUiTheme,
  useTheme
} from '@/composables/useTheme'

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    document.documentElement.removeAttribute('data-theme')
    // Reset module-level initialized flag by re-applying defaults through init
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    document.documentElement.removeAttribute('data-theme')
  })

  it('initTheme 默认 current + 系统浅色', () => {
    initTheme()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('current')
    const { colorMode, uiTheme } = useTheme()
    expect(colorMode.value).toBe('light')
    expect(uiTheme.value).toBe('current')
  })

  it('initTheme 读取 localStorage 并应用到 DOM', () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dark')
    localStorage.setItem(UI_THEME_STORAGE_KEY, 'apple')
    initTheme()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('apple')
  })

  it('setColorMode 同步 class 与 storage', () => {
    initTheme()
    setColorMode('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('dark')
    setColorMode('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('light')
  })

  it('toggleColorMode 在 light/dark 间切换', () => {
    initTheme()
    toggleColorMode()
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('dark')
    toggleColorMode()
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('light')
  })

  it('setUiTheme 切换 data-theme 且不影响 dark class', () => {
    initTheme()
    setColorMode('dark')
    setUiTheme('apple')
    expect(document.documentElement.getAttribute('data-theme')).toBe('apple')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem(UI_THEME_STORAGE_KEY)).toBe('apple')
  })

  it('cycleUiTheme 在 current 与 apple 间循环', () => {
    initTheme()
    expect(cycleUiTheme()).toBe('apple')
    expect(cycleUiTheme()).toBe('current')
  })

  it('useTheme 暴露 isDark / isApple 派生状态', () => {
    initTheme()
    const theme = useTheme()
    expect(theme.isDark.value).toBe(false)
    expect(theme.isApple.value).toBe(false)
    setColorMode('dark')
    setUiTheme('apple')
    expect(theme.isDark.value).toBe(true)
    expect(theme.isApple.value).toBe(true)
  })
})
