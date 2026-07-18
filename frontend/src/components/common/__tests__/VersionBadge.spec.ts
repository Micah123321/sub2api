import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { VersionInfo } from '@/api/admin/system'
import type { User } from '@/types'
import { useAppStore, useAuthStore } from '@/stores'
import VersionBadge from '../VersionBadge.vue'

const systemMocks = vi.hoisted(() => ({
  checkUpdates: vi.fn(),
  performUpdate: vi.fn(),
  restartService: vi.fn(),
  getRollbackVersions: vi.fn(),
  rollback: vi.fn(),
  setUpdateChannel: vi.fn()
}))

const i18nMocks = vi.hoisted(() => ({
  t: (key: string) =>
    ({
      'version.updateAvailable': '有新版本可用！',
      'version.currentVersion': '当前版本',
      'version.refresh': '刷新',
      'version.updateChannel': '更新通道',
      'version.channelOfficial': '官方',
      'version.channelCustom': '自定义',
      'version.latestVersion': '最新版本',
      'version.upToDate': '已是最新版本',
      'version.versionCheckFailed': '版本检查失败，请重试',
      'version.versionCheckWarning': '暂时无法确认最新版本，请重试',
      'version.retry': '重试',
      'version.nonDockerNoOneClick': '非 Docker 环境不可一键升级，请使用命令行手动更新',
      'version.dockerEditCompose': '修改 docker-compose.yml 中的镜像版本',
      'version.dockerRecreate': '重新创建容器',
      'version.manualUpdateCommand': '手动更新命令',
      'version.copyCommand': '复制',
      'version.copied': '已复制',
      'version.updateNow': '立即更新',
      'version.updating': '正在更新...',
      'version.updateComplete': '更新完成',
      'version.restartRequired': '请重启服务以应用更新',
      'version.noRestartRequired': '更新已生效，无需重启服务',
      'version.restartNow': '立即重启',
      'version.unsupportedUpdateMethod': '当前更新方式不受支持，请手动更新或联系管理员',
      'version.manualCommandUnavailable': '暂无可用的手动更新命令，请联系管理员确认部署方式'
    })[key] ?? key
}))

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({ t: i18nMocks.t })
  }
})

vi.mock('@/api/admin/system', () => ({
  checkUpdates: systemMocks.checkUpdates,
  performUpdate: systemMocks.performUpdate,
  restartService: systemMocks.restartService,
  getRollbackVersions: systemMocks.getRollbackVersions,
  rollback: systemMocks.rollback,
  setUpdateChannel: systemMocks.setUpdateChannel,
  default: {
    checkUpdates: systemMocks.checkUpdates,
    performUpdate: systemMocks.performUpdate,
    restartService: systemMocks.restartService,
    getRollbackVersions: systemMocks.getRollbackVersions,
    rollback: systemMocks.rollback,
    setUpdateChannel: systemMocks.setUpdateChannel
  }
}))

const mountedWrappers: VueWrapper[] = []

function createVersionInfo(overrides: Partial<VersionInfo> = {}): VersionInfo {
  return {
    current_version: '1.0.0',
    latest_version: '1.1.0',
    has_update: true,
    cached: false,
    build_type: 'release',
    channel: 'official',
    update_method: 'docker',
    image: 'weishaw/sub2api',
    latest_tag: '1.1.0',
    manual_command: '',
    ...overrides
  }
}

function createAdminPinia() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const authStore = useAuthStore()
  authStore.user = { role: 'admin' } as User

  return pinia
}

async function mountAdminWithApiResponse(versionInfo: VersionInfo) {
  const pinia = createAdminPinia()
  const appStore = useAppStore()
  systemMocks.checkUpdates.mockResolvedValueOnce(versionInfo)
  await appStore.fetchVersion(true)

  const wrapper = mount(VersionBadge, {
    global: {
      plugins: [pinia]
    }
  })
  mountedWrappers.push(wrapper)
  await flushPromises()

  return { appStore, wrapper }
}

beforeEach(() => {
  Object.values(systemMocks).forEach((mock) => mock.mockReset())
  localStorage.clear()
})

afterEach(() => {
  mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})

describe('VersionBadge', () => {
  it.each(['1.2.3', 'v1.2.3'])('renders exactly one v prefix for version %s', (version) => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const wrapper = mount(VersionBadge, {
      props: { version },
      global: {
        plugins: [pinia]
      }
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.text()).toBe('v1.2.3')
  })

  it('uses the custom API image and tag in the fallback command', async () => {
    const image = 'ghcr.io/acme/sub2api'
    const tag = 'custom-release-20260718'
    const { wrapper } = await mountAdminWithApiResponse(
      createVersionInfo({
        latest_version: '9.9.9',
        channel: 'custom',
        update_method: 'manual',
        image,
        latest_tag: tag,
        manual_command: ''
      })
    )

    expect(systemMocks.checkUpdates).toHaveBeenCalledWith(true)
    await wrapper.get('button').trigger('click')

    const command = wrapper.get('code').text()
    expect(command).toContain(`image: ${image}:${tag}`)
    expect(command).not.toContain(`image: ${image}:9.9.9`)
    expect(command).not.toContain('ghcr.io/micah123321/sub2api')
  })

  it('does not show the up-to-date message when the version check fails', async () => {
    const pinia = createAdminPinia()
    const appStore = useAppStore()
    appStore.currentVersion = '1.2.3'
    systemMocks.checkUpdates.mockRejectedValueOnce(new Error('network unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const wrapper = mount(VersionBadge, {
      global: {
        plugins: [pinia]
      }
    })
    mountedWrappers.push(wrapper)
    await flushPromises()
    await wrapper.get('button').trigger('click')

    expect(wrapper.text()).toContain('版本检查失败，请重试')
    expect(wrapper.text()).not.toContain('已是最新版本')
  })

  it('does not show the up-to-date message when registry metadata is unverified', async () => {
    const { wrapper } = await mountAdminWithApiResponse(
      createVersionInfo({
        has_update: false,
        current_version: '0.1.160-custom.e191eba5',
        latest_version: '0.1.160-custom.e191eba5',
        channel: 'custom',
        warning: 'custom registry metadata is incomplete'
      })
    )

    await wrapper.get('button').trigger('click')

    expect(wrapper.text()).toContain('暂时无法确认最新版本，请重试')
    expect(wrapper.text()).not.toContain('已是最新版本')
  })

  it('does not show a restart action after an update that needs no restart', async () => {
    const { wrapper } = await mountAdminWithApiResponse(createVersionInfo())
    systemMocks.performUpdate.mockResolvedValueOnce({
      message: 'updated',
      need_restart: false
    })

    await wrapper.get('button').trigger('click')
    const updateButton = wrapper.findAll('button').find((button) => button.text().includes('立即更新'))
    expect(updateButton).toBeDefined()

    await updateButton!.trigger('click')
    await flushPromises()

    expect(systemMocks.performUpdate).toHaveBeenCalledTimes(1)
    expect(systemMocks.restartService).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('更新完成')
    expect(wrapper.text()).toContain('更新已生效，无需重启服务')
    expect(wrapper.text()).not.toContain('请重启服务以应用更新')
    expect(wrapper.findAll('button').some((button) => button.text().includes('立即重启'))).toBe(false)
  })

  it('does not show one-click update for an unknown update method', async () => {
    const { wrapper } = await mountAdminWithApiResponse(
      createVersionInfo({ update_method: 'unsupported-method' })
    )

    await wrapper.get('button').trigger('click')

    expect(wrapper.text()).toContain('当前更新方式不受支持')
    expect(wrapper.findAll('button').some((button) => button.text().includes('立即更新'))).toBe(false)
    expect(systemMocks.performUpdate).not.toHaveBeenCalled()
  })
})
