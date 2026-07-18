import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  opsAPI: {
    listAlertRules: vi.fn().mockResolvedValue([]),
    createAlertRule: vi.fn().mockResolvedValue({}),
    updateAlertRule: vi.fn(),
    deleteAlertRule: vi.fn()
  },
  adminAPI: {
    groups: {
      getAll: vi.fn().mockResolvedValue([])
    }
  },
  appStore: {
    showError: vi.fn(),
    showSuccess: vi.fn()
  }
}))

const labels: Record<string, string> = {
  'admin.ops.alertRules.create': 'Create Rule',
  'admin.ops.alertRules.saveSuccess': 'Alert rule saved',
  'admin.ops.alertRules.validation.nameRequired': 'Name is required',
  'admin.ops.alertRules.validation.keywordRequired': 'A keyword is required for this metric',
  'common.save': 'Save',
  'common.saving': 'Saving',
  'common.cancel': 'Cancel'
}

vi.mock('@/api', () => ({ adminAPI: mocks.adminAPI }))
vi.mock('@/api/admin/ops', () => ({ opsAPI: mocks.opsAPI }))
vi.mock('@/stores/app', () => ({ useAppStore: () => mocks.appStore }))
vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => labels[key] ?? key
    })
  }
})

const BaseDialogStub = defineComponent({
  props: {
    show: {
      type: Boolean,
      default: false
    }
  },
  setup(props, { slots }) {
    return () => props.show
      ? h('div', { 'data-test': 'base-dialog' }, [
          ...(slots.default?.() ?? []),
          ...(slots.footer?.() ?? [])
        ])
      : null
  }
})

const SelectStub = defineComponent({
  props: {
    modelValue: {
      default: null
    },
    options: {
      type: Array,
      default: () => []
    }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h(
      'select',
      {
        value: props.modelValue == null ? '' : String(props.modelValue),
        onChange: (event: Event) => {
          const value = (event.target as HTMLSelectElement).value
          const option = (props.options as Array<{ value: unknown }>).find(
            (item) => String(item.value ?? '') === value
          )
          emit('update:modelValue', option?.value ?? value)
        }
      },
      (props.options as Array<{ value: unknown; label: string; disabled?: boolean }>).map((option) =>
        h('option', {
          value: String(option.value ?? ''),
          disabled: option.disabled
        }, option.label)
      )
    )
  }
})

const ConfirmDialogStub = defineComponent({
  setup() {
    return () => null
  }
})

import OpsAlertRulesCard from '../OpsAlertRulesCard.vue'

describe('OpsAlertRulesCard keyword metric', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.opsAPI.listAlertRules.mockResolvedValue([])
    mocks.adminAPI.groups.getAll.mockResolvedValue([])
    mocks.opsAPI.createAlertRule.mockResolvedValue({})
  })

  it('requires a keyword and submits it in filters', async () => {
    const wrapper = mount(OpsAlertRulesCard, {
      global: {
        stubs: {
          BaseDialog: BaseDialogStub,
          Select: SelectStub,
          ConfirmDialog: ConfirmDialogStub
        }
      }
    })
    await flushPromises()

    const createButton = wrapper.find('button.btn-primary')
    await createButton.trigger('click')
    await nextTick()

    const metricSelect = wrapper.find('select')
    await metricSelect.setValue('keyword_normal_accounts')
    await nextTick()
    expect(wrapper.find('input[type="search"]').exists()).toBe(true)

    await wrapper.find('input[type="text"]').setValue('Low Claude pool')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'Save')
    expect(saveButton).toBeDefined()
    await saveButton!.trigger('click')
    expect(mocks.appStore.showError).toHaveBeenCalledWith('A keyword is required for this metric')
    expect(mocks.opsAPI.createAlertRule).not.toHaveBeenCalled()

    await wrapper.find('input[type="search"]').setValue('claude')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(mocks.opsAPI.createAlertRule).toHaveBeenCalledWith(
      expect.objectContaining({
        metric_type: 'keyword_normal_accounts',
        filters: { keyword: 'claude' }
      })
    )
  })
})
