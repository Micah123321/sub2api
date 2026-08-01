<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api/client';

interface MainServiceView {
  configured: boolean;
  baseUrl: string;
  adminEmailMasked: string;
  passwordConfigured: boolean;
  credentialVersion: number;
}

interface ConnectionTestView {
  ok: boolean;
  sampleUserCount?: number;
  message?: string;
}

const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const message = ref('');
const error = ref('');
const baseUrl = ref('');
const adminEmail = ref('');
const adminPassword = ref('');
const view = ref<MainServiceView | null>(null);

async function load() {
  loading.value = true;
  error.value = '';
  const result = await api.settings();
  loading.value = false;
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  view.value = (result.data as MainServiceView | undefined) || null;
  baseUrl.value = String(result.data?.baseUrl || '');
}

async function save() {
  saving.value = true;
  message.value = '';
  error.value = '';
  const result = await api.saveSettings({
    baseUrl: baseUrl.value,
    adminEmail: adminEmail.value || undefined,
    adminPassword: adminPassword.value || undefined,
  });
  saving.value = false;
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  message.value = '已保存管理员登录配置';
  adminEmail.value = '';
  adminPassword.value = '';
  await load();
}

async function test() {
  testing.value = true;
  message.value = '';
  error.value = '';
  const result = await api.testSettings({
    baseUrl: baseUrl.value || undefined,
    adminEmail: adminEmail.value || undefined,
    adminPassword: adminPassword.value || undefined,
  });
  testing.value = false;
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  const data = result.data as ConnectionTestView | undefined;
  if (data?.ok) {
    message.value = `连接成功，用户总数约 ${data.sampleUserCount ?? 0}`;
  } else {
    error.value = data?.message || '连接失败';
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="page-title">主服务连接</h1>
    <section class="panel stack">
      <p class="muted">管理员凭据仅在服务端加密保存，密码不会回传到浏览器。</p>
      <p v-if="loading" class="muted">加载中…</p>
      <form v-else class="form-grid" @submit.prevent="save">
        <label>
          Base URL
          <input v-model="baseUrl" placeholder="http://localhost:3000" required />
        </label>
        <label>
          管理员邮箱（留空表示不修改）
          <input
            v-model="adminEmail"
            type="email"
            autocomplete="username"
            placeholder="admin@example.com"
          />
        </label>
        <label>
          管理员密码（留空表示不修改）
          <input
            v-model="adminPassword"
            type="password"
            autocomplete="new-password"
            placeholder="输入主服务管理员密码"
          />
        </label>
        <div v-if="view" class="muted">
          当前账号: <span class="mono">{{ view.adminEmailMasked || '—' }}</span>
          · 密码{{ view.passwordConfigured ? '已配置' : '未配置' }}
          · 凭据版本 {{ view.credentialVersion || 0 }}
        </div>
        <div class="row-actions">
          <button type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button>
          <button class="secondary" type="button" :disabled="testing" @click="test">
            {{ testing ? '测试中…' : '测试连接' }}
          </button>
        </div>
        <p v-if="message" class="success">{{ message }}</p>
        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </section>
  </div>
</template>
