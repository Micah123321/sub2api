<template>
  <div class="space-y-4 rounded-lg border border-gray-200 bg-gray-50/50 p-4 dark:border-dark-600 dark:bg-dark-800/40">
    <!-- 标题和说明 -->
    <div>
      <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300">
        {{ t('admin.groups.openaiApiKey.title') }}
      </h3>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {{ t('admin.groups.openaiApiKey.description') }}
      </p>
    </div>

    <!-- 配置状态显示（编辑模式） -->
    <div v-if="mode === 'edit' && hasExistingKey" class="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 dark:border-dark-600 dark:bg-dark-800">
      <div class="flex items-center gap-2">
        <Icon name="check" size="sm" class="text-green-500" />
        <span class="text-sm text-gray-700 dark:text-gray-300">
          {{ t('admin.groups.openaiApiKey.configured') }}
        </span>
        <code class="ml-2 rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600 dark:bg-dark-700 dark:text-gray-400">
          {{ maskedKey }}
        </code>
      </div>
      <button
        type="button"
        @click="showUpdateInput = !showUpdateInput"
        class="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400"
      >
        {{ showUpdateInput ? t('common.cancel') : t('admin.groups.openaiApiKey.update') }}
      </button>
    </div>

    <!-- API Key 输入区域 -->
    <div v-if="mode === 'create' || !hasExistingKey || showUpdateInput" class="space-y-3">
      <!-- 输入框 -->
      <div>
        <label class="input-label">
          {{ t('admin.groups.openaiApiKey.inputLabel') }}
        </label>
        <div class="relative">
          <input
            v-model="localApiKey"
            :type="showKey ? 'text' : 'password'"
            class="input pr-20"
            :placeholder="t('admin.groups.openaiApiKey.placeholder')"
            @input="clearValidation"
          />
          <div class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            <!-- 显示/隐藏按钮 -->
            <button
              type="button"
              @click="showKey = !showKey"
              class="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-dark-700 dark:hover:text-gray-300"
              :title="showKey ? t('common.hide') : t('common.show')"
            >
              <Icon :name="showKey ? 'eyeOff' : 'eye'" size="sm" />
            </button>
            <!-- 验证按钮 -->
            <button
              v-if="localApiKey"
              type="button"
              @click="validateKey"
              :disabled="validating"
              class="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-50 dark:text-primary-400 dark:hover:bg-primary-900/20"
            >
              <span v-if="validating">{{ t('admin.groups.openaiApiKey.validating') }}</span>
              <span v-else>{{ t('admin.groups.openaiApiKey.validate') }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 验证结果 -->
      <div v-if="validationResult" :class="[
        'flex items-start gap-2 rounded-lg border p-3 text-sm',
        validationResult.valid
          ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'
          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
      ]">
        <Icon
          :name="validationResult.valid ? 'check' : 'x'"
          size="sm"
          class="mt-0.5 flex-shrink-0"
        />
        <div class="flex-1">
          <p v-if="validationResult.valid">
            {{ t('admin.groups.openaiApiKey.validSuccess') }}
          </p>
          <p v-else>
            {{ t('admin.groups.openaiApiKey.validFailed') }}
            <span v-if="validationResult.error" class="block mt-1 text-xs">
              {{ validationResult.error }}
            </span>
          </p>
          <div v-if="validationResult.models && validationResult.models.length > 0" class="mt-2">
            <p class="text-xs font-medium">
              {{ t('admin.groups.openaiApiKey.availableModels') }} ({{ validationResult.models.length }}):
            </p>
            <div class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="model in validationResult.models.slice(0, 10)"
                :key="model"
                class="rounded bg-white px-2 py-0.5 text-xs font-mono dark:bg-dark-800"
              >
                {{ model }}
              </span>
              <span
                v-if="validationResult.models.length > 10"
                class="rounded px-2 py-0.5 text-xs"
              >
                +{{ validationResult.models.length - 10 }} more
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 清除按钮（编辑模式更新时） -->
      <div v-if="mode === 'edit' && showUpdateInput">
        <button
          type="button"
          @click="clearKey"
          class="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700 dark:text-red-400"
        >
          <Icon name="trash" size="sm" />
          {{ t('admin.groups.openaiApiKey.clear') }}
        </button>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {{ t('admin.groups.openaiApiKey.clearHint') }}
        </p>
      </div>

      <!-- 提示信息 -->
      <div class="rounded-lg bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
        <p class="mb-1 font-medium">{{ t('admin.groups.openaiApiKey.usage.title') }}</p>
        <ul class="list-inside list-disc space-y-0.5">
          <li>{{ t('admin.groups.openaiApiKey.usage.step1') }}</li>
          <li>{{ t('admin.groups.openaiApiKey.usage.step2') }}</li>
          <li>{{ t('admin.groups.openaiApiKey.usage.step3') }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/common/Icon.vue'
import { validateOpenAIApiKey } from '@/api/admin/groups'

interface Props {
  modelValue: string | null | undefined
  mode: 'create' | 'edit'
  existingKeyMasked?: string | null
}

interface Emits {
  (e: 'update:modelValue', value: string | null): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const { t } = useI18n()

const localApiKey = ref<string>('')
const showKey = ref(false)
const showUpdateInput = ref(false)
const validating = ref(false)
const validationResult = ref<{
  valid: boolean
  error?: string
  models?: string[]
} | null>(null)

const hasExistingKey = computed(() => {
  return props.mode === 'edit' && props.existingKeyMasked
})

const maskedKey = computed(() => {
  return props.existingKeyMasked || ''
})

watch(() => props.modelValue, (newVal) => {
  if (newVal !== localApiKey.value) {
    localApiKey.value = newVal || ''
  }
}, { immediate: true })

watch(localApiKey, (newVal) => {
  emit('update:modelValue', newVal || null)
})

const clearValidation = () => {
  validationResult.value = null
}

const validateKey = async () => {
  if (!localApiKey.value) return

  validating.value = true
  validationResult.value = null

  try {
    const result = await validateOpenAIApiKey(localApiKey.value)
    validationResult.value = result
  } catch (error: any) {
    validationResult.value = {
      valid: false,
      error: error.message || t('admin.groups.openaiApiKey.validationError')
    }
  } finally {
    validating.value = false
  }
}

const clearKey = () => {
  localApiKey.value = ''
  showUpdateInput.value = false
  validationResult.value = null
}
</script>
