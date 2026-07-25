<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api/client';

const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const message = ref('');
const error = ref('');
const baseUrl = ref('');
const apiKey = ref('');
const view = ref<Record<string, any> | null>(null);

async function load() {
  loading.value = true;
  error.value = '';
  const result = await api.settings();
  loading.value = false;
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  view.value = result.data || null;
  baseUrl.value = String(result.data?.baseUrl || '');
}

async function save() {
  saving.value = true;
  message.value = '';
  error.value = '';
  const result = await api.saveSettings({
    baseUrl: baseUrl.value,
    apiKey: apiKey.value || undefined,
  });
  saving.value = false;
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  message.value = '已保存（API Key 仅服务端加密存储）';
  apiKey.value = '';
  await load();
}

async function test() {
  testing.value = true;
  message.value = '';
  error.value = '';
  const result = await api.testSettings({
    baseUrl: baseUrl.value || undefined,
    apiKey: apiKey.value || undefined,
  });
  testing.value = false;
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  const data = result.data as any;
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
      <p class="muted">Admin API Key 不会回传到前端明文。设置页只显示脱敏值。</p>
      <p v-if="loading" class="muted">加载中…</p>
      <form v-else class="form-grid" @submit.prevent="save">
        <label>
          Base URL
          <input v-model="baseUrl" placeholder="http://localhost:3000" required />
        </label>
        <label>
          Admin API Key（留空表示不修改）
          <input v-model="apiKey" type="password" autocomplete="off" placeholder="x-api-key" />
        </label>
        <div v-if="view" class="muted mono">
          当前脱敏: {{ view.apiKeyMasked || '—' }} · keyVersion={{ view.keyVersion || 0 }}
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
