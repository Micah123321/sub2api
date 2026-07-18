import { computed, ref } from 'vue'

export type ColorMode = 'light' | 'dark'
export type UiTheme = 'current' | 'apple'

export const COLOR_MODE_STORAGE_KEY = 'theme'
export const UI_THEME_STORAGE_KEY = 'ui-theme'

export const UI_THEMES: readonly UiTheme[] = ['current', 'apple'] as const

const colorMode = ref<ColorMode>('light')
const uiTheme = ref<UiTheme>('current')
let initialized = false

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function readStoredColorMode(): ColorMode | null {
  if (!isBrowser()) return null
  try {
    const saved = localStorage.getItem(COLOR_MODE_STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    // ignore storage access errors (private mode / SSR-like hosts)
  }
  return null
}

function readStoredUiTheme(): UiTheme | null {
  if (!isBrowser()) return null
  try {
    const saved = localStorage.getItem(UI_THEME_STORAGE_KEY)
    if (saved === 'current' || saved === 'apple') return saved
  } catch {
    // ignore
  }
  return null
}

function preferDarkFromSystem(): boolean {
  if (!isBrowser() || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

function persistColorMode(mode: ColorMode): void {
  if (!isBrowser()) return
  try {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode)
  } catch {
    // ignore
  }
}

function persistUiTheme(theme: UiTheme): void {
  if (!isBrowser()) return
  try {
    localStorage.setItem(UI_THEME_STORAGE_KEY, theme)
  } catch {
    // ignore
  }
}

function applyColorMode(mode: ColorMode): void {
  if (!isBrowser()) return
  document.documentElement.classList.toggle('dark', mode === 'dark')
}

function applyUiTheme(theme: UiTheme): void {
  if (!isBrowser()) return
  document.documentElement.setAttribute('data-theme', theme)
}

/**
 * Apply theme classes before Vue mount to avoid FOUC.
 * Safe to call multiple times.
 */
export function initTheme(): void {
  const storedMode = readStoredColorMode()
  const nextMode: ColorMode = storedMode ?? (preferDarkFromSystem() ? 'dark' : 'light')
  const nextTheme: UiTheme = readStoredUiTheme() ?? 'current'

  colorMode.value = nextMode
  uiTheme.value = nextTheme
  applyColorMode(nextMode)
  applyUiTheme(nextTheme)
  initialized = true
}

export function setColorMode(mode: ColorMode): void {
  if (!initialized) initTheme()
  colorMode.value = mode
  applyColorMode(mode)
  persistColorMode(mode)
}

export function toggleColorMode(): void {
  setColorMode(colorMode.value === 'dark' ? 'light' : 'dark')
}

export function setUiTheme(theme: UiTheme): void {
  if (!initialized) initTheme()
  if (!UI_THEMES.includes(theme)) return
  uiTheme.value = theme
  applyUiTheme(theme)
  persistUiTheme(theme)
}

export function cycleUiTheme(): UiTheme {
  if (!initialized) initTheme()
  const idx = UI_THEMES.indexOf(uiTheme.value)
  const next = UI_THEMES[(idx + 1) % UI_THEMES.length]
  setUiTheme(next)
  return next
}

/**
 * Shared theme state for layout chrome (sidebar / home / switcher).
 */
export function useTheme() {
  if (!initialized && isBrowser()) {
    initTheme()
  }

  const isDark = computed(() => colorMode.value === 'dark')
  const isApple = computed(() => uiTheme.value === 'apple')

  return {
    colorMode,
    uiTheme,
    isDark,
    isApple,
    setColorMode,
    toggleColorMode,
    setUiTheme,
    cycleUiTheme,
    initTheme
  }
}
