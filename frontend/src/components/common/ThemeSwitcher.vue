<template>
  <div class="relative" ref="dropdownRef">
    <button
      type="button"
      @click="toggleDropdown"
      class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-dark-700"
      :title="t('nav.theme')"
      :aria-label="t('nav.theme')"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
    >
      <Icon name="sparkles" size="sm" class="text-primary-500" />
      <span class="hidden sm:inline">{{ currentLabel }}</span>
      <Icon
        name="chevronDown"
        size="xs"
        class="text-gray-400 transition-transform duration-200"
        :class="{ 'rotate-180': isOpen }"
      />
    </button>

    <transition name="dropdown">
      <div
        v-if="isOpen"
        role="listbox"
        class="absolute right-0 z-50 mt-1 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-dark-700 dark:bg-dark-800"
      >
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          role="option"
          :aria-selected="option.value === uiTheme"
          @click="selectTheme(option.value)"
          class="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-dark-700"
          :class="{
            'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400':
              option.value === uiTheme
          }"
        >
          <span class="h-2.5 w-2.5 flex-shrink-0 rounded-full" :class="option.swatch" />
          <span>{{ option.label }}</span>
          <Icon
            v-if="option.value === uiTheme"
            name="check"
            size="sm"
            class="ml-auto text-primary-500"
          />
        </button>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import { useTheme, type UiTheme } from '@/composables/useTheme'

const { t } = useI18n()
const { uiTheme, setUiTheme } = useTheme()

const isOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

const options = computed(() => [
  {
    value: 'current' as UiTheme,
    label: t('nav.themeCurrent'),
    swatch: 'bg-teal-500'
  },
  {
    value: 'apple' as UiTheme,
    label: t('nav.themeApple'),
    swatch: 'bg-blue-600'
  }
])

const currentLabel = computed(
  () => options.value.find((o) => o.value === uiTheme.value)?.label ?? t('nav.theme')
)

function toggleDropdown() {
  isOpen.value = !isOpen.value
}

function selectTheme(theme: UiTheme) {
  setUiTheme(theme)
  isOpen.value = false
}

function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    isOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-4px);
}
</style>
