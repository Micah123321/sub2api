<template>
  <section id="docs" class="docs-section mb-16 scroll-mt-6" data-testid="home-docs">
    <div class="docs-section-header">
      <div class="max-w-2xl">
        <p class="docs-eyebrow">{{ t('home.documentation.eyebrow') }}</p>
        <h2 class="docs-section-title">{{ t('home.documentation.title') }}</h2>
        <p class="docs-section-description">{{ t('home.documentation.description') }}</p>
      </div>

      <div class="docs-section-actions">
        <a
          v-if="normalizedDocUrl"
          :href="normalizedDocUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="docs-link docs-link-primary"
        >
          <span>{{ t('home.documentation.openFullDocs') }}</span>
          <Icon name="arrowRight" size="sm" aria-hidden="true" />
        </a>
        <router-link
          :to="isAuthenticated ? dashboardPath : '/login'"
          class="docs-link docs-link-secondary"
        >
          <span>{{ isAuthenticated ? t('home.dashboard') : t('home.getStarted') }}</span>
          <Icon name="arrowRight" size="sm" aria-hidden="true" />
        </router-link>
      </div>
    </div>

    <div class="docs-endpoint">
      <div class="docs-endpoint-content">
        <span class="docs-endpoint-label">{{ t('home.documentation.endpointLabel') }}</span>
        <code data-testid="api-endpoint">{{ apiEndpoint }}</code>
      </div>
      <button
        type="button"
        class="docs-copy-button"
        data-testid="copy-api-endpoint"
        :aria-label="copyStatusLabel"
        @click="copyApiEndpoint"
      >
        <Icon
          :name="copyStatus === 'copied' ? 'check' : 'copy'"
          size="sm"
          aria-hidden="true"
        />
        <span aria-live="polite">{{ copyStatusLabel }}</span>
      </button>
    </div>

    <div class="docs-card-grid">
      <component
        :is="normalizedDocUrl ? 'a' : 'article'"
        v-for="(card, index) in documentCards"
        :key="card.id"
        class="docs-card"
        data-testid="documentation-card"
        :href="normalizedDocUrl || undefined"
        :target="normalizedDocUrl ? '_blank' : undefined"
        :rel="normalizedDocUrl ? 'noopener noreferrer' : undefined"
      >
        <div class="docs-card-topline">
          <div class="docs-card-icon">
            <Icon :name="card.icon" size="md" aria-hidden="true" />
          </div>
          <span class="docs-card-index">0{{ index + 1 }}</span>
        </div>
        <h3 class="docs-card-title">{{ cardText(card.id, 'title') }}</h3>
        <p class="docs-card-description">{{ cardText(card.id, 'description') }}</p>
        <div class="docs-card-meta">
          <span>{{ cardText(card.id, 'meta') }}</span>
          <Icon name="arrowRight" size="sm" aria-hidden="true" />
        </div>
      </component>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import '@/styles/home-documentation.css'

const props = defineProps<{
  docUrl: string
  isAuthenticated: boolean
  dashboardPath: string
  apiBaseUrl: string
}>()

const { t } = useI18n()

type DocumentCardId = 'quickStart' | 'apiAccess' | 'cliSdk' | 'troubleshooting'
type CopyStatus = 'idle' | 'copied' | 'failed'

const documentCards = [
  { id: 'quickStart' as const, icon: 'play' as const },
  { id: 'apiAccess' as const, icon: 'server' as const },
  { id: 'cliSdk' as const, icon: 'terminal' as const },
  { id: 'troubleshooting' as const, icon: 'shield' as const }
]

const normalizedDocUrl = computed(() => props.docUrl.trim())

const apiEndpoint = computed(() => {
  const base = props.apiBaseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
  return base ? base + '/v1' : '/v1'
})
const copyStatus = ref<CopyStatus>('idle')
const copyResetTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const copyStatusLabel = computed(() => {
  if (copyStatus.value === 'copied') return t('home.documentation.copied')
  if (copyStatus.value === 'failed') return t('home.documentation.copyFailed')
  return t('home.documentation.copy')
})

function cardText(id: DocumentCardId, field: 'title' | 'description' | 'meta') {
  return t('home.documentation.cards.' + id + '.' + field)
}

function scheduleCopyStatusReset() {
  if (copyResetTimer.value) {
    clearTimeout(copyResetTimer.value)
  }
  copyResetTimer.value = setTimeout(() => {
    copyStatus.value = 'idle'
    copyResetTimer.value = null
  }, 2200)
}

async function copyApiEndpoint() {
  try {
    let copied = false
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(apiEndpoint.value)
      copied = true
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = apiEndpoint.value
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      try {
        textarea.select()
        copied = document.execCommand('copy')
      } finally {
        textarea.remove()
      }
    }
    copyStatus.value = copied ? 'copied' : 'failed'
  } catch {
    copyStatus.value = 'failed'
  }
  scheduleCopyStatusReset()
}

onBeforeUnmount(() => {
  if (copyResetTimer.value) {
    clearTimeout(copyResetTimer.value)
  }
})
</script>

