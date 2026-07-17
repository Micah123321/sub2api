import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh'

const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')

describe('Conversation Logs integration surface', () => {
  it('registers an admin-only lazy route independent of risk control', () => {
    const router = read('../../router/index.ts')
    const start = router.indexOf("path: '/admin/conversation-logs'")
    const route = router.slice(start, router.indexOf("\n  {", start))
    expect(start).toBeGreaterThan(-1)
    expect(route).toContain("import('@/features/conversation-logs/ConversationLogsView.vue')")
    expect(route).toContain('requiresAuth: true')
    expect(route).toContain('requiresAdmin: true')
    expect(route).not.toContain('requiresRiskControl')
  })

  it('places the navigation entry beside usage and audit logs', () => {
    const sidebar = read('../../components/layout/AppSidebar.vue')
    const usage = sidebar.indexOf("path: '/admin/usage'")
    const conversations = sidebar.indexOf("path: '/admin/conversation-logs'")
    const audit = sidebar.indexOf("path: '/admin/audit-logs'")
    expect(usage).toBeGreaterThan(-1)
    expect(conversations).toBeGreaterThan(usage)
    expect(audit).toBeGreaterThan(conversations)
    expect(sidebar.slice(conversations, audit)).toContain("t('nav.conversationLogs')")
    expect(sidebar.slice(conversations, audit)).not.toMatch(/[😀-🙏]/u)
  })

  it('keeps locale trees symmetric and names all operational areas', () => {
    expect(zh.nav.conversationLogs).toBeTruthy()
    expect(en.nav.conversationLogs).toBeTruthy()
    expect(Object.keys(zh.admin.conversationLogs)).toEqual(Object.keys(en.admin.conversationLogs))
    for (const section of ['filters', 'status', 'columns', 'runtime', 'detail', 'roles', 'events', 'cleanup']) {
      const zhSection = zh.admin.conversationLogs[section as keyof typeof zh.admin.conversationLogs]
      const enSection = en.admin.conversationLogs[section as keyof typeof en.admin.conversationLogs]
      expect(Object.keys(zhSection)).toEqual(Object.keys(enSection))
    }
  })
})
