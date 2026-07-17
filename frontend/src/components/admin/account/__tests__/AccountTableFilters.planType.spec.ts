import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import AccountTableFilters from '../AccountTableFilters.vue'

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => key })
  }
})

const SelectStub = {
  props: ['modelValue', 'options', 'ariaLabel'],
  emits: ['update:modelValue', 'change'],
  template: '<button class="select-stub" @click="$emit(\'update:modelValue\', \'team\')">select</button>'
}

const mountFilters = (filters: Record<string, unknown>) => mount(AccountTableFilters, {
  props: { searchQuery: '', filters },
  global: {
    stubs: {
      Select: SelectStub,
      SearchInput: true
    }
  }
})

describe('AccountTableFilters plan type filter', () => {
  it('shows the complete plan list for OpenAI and emits plan_type updates', async () => {
    const wrapper = mountFilters({ platform: 'openai', plan_type: '' })
    const planFilter = wrapper.findAllComponents(SelectStub)
      .find(select => select.attributes('data-test') === 'plan-type-filter')

    expect(planFilter).toBeDefined()
    expect(planFilter?.props('options')).toEqual([
      { value: '', label: 'admin.accounts.allPlanTypes' },
      { value: 'k12', label: 'K12' },
      { value: 'team', label: 'Team' },
      { value: 'plus', label: 'Plus' },
      { value: 'pro', label: 'Pro' },
      { value: 'free', label: 'Free' }
    ])
    expect(planFilter?.props('ariaLabel')).toBe('admin.accounts.planTypeFilterLabel')

    await planFilter?.trigger('click')
    expect(wrapper.emitted('update:filters')?.at(-1)?.[0]).toMatchObject({ plan_type: 'team' })
  })

  it('clears plan_type when platform changes away from OpenAI', async () => {
    const wrapper = mountFilters({ platform: 'openai', plan_type: 'plus' })
    const platformFilter = wrapper.findAllComponents(SelectStub)[0]

    platformFilter.vm.$emit('update:modelValue', 'anthropic')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:filters')?.at(-1)?.[0]).toMatchObject({
      platform: 'anthropic',
      plan_type: ''
    })

    await wrapper.setProps({ filters: { platform: 'anthropic', plan_type: '' } })
    expect(wrapper.find('[data-test="plan-type-filter"]').exists()).toBe(false)
  })
})
