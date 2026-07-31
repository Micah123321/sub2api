<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api/client';
import { formatMoney, formatTime } from '../../types';

const loading = ref(true);
const error = ref('');
const data = ref<Record<string, any> | null>(null);

onMounted(async () => {
  const result = await api.overview();
  loading.value = false;
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  data.value = result.data || null;
});
</script>

<template>
  <div>
    <h1 class="page-title">运营总览</h1>
    <p v-if="loading" class="muted">加载中…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <template v-else-if="data">
      <div class="grid-3">
        <div class="stat">
          <div class="stat-label">代理商</div>
          <div class="stat-value">{{ data.agentCount }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">有效绑定</div>
          <div class="stat-value">{{ data.bindingCount }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">本地余额合计</div>
          <div class="stat-value">{{ formatMoney(data.localBalanceMinor || 0) }}</div>
        </div>
      </div>
      <section class="panel">
        <h2 class="section-title">同步状态</h2>
        <div class="row-actions">
          <span class="source-chip remote">远程</span>
          <span class="mono">{{ data.latestSync?.status || '尚未同步' }}</span>
          <span class="muted mono">{{ formatTime(data.latestSync?.finishedAt || data.latestSync?.startedAt) }}</span>
        </div>
        <p v-if="data.latestSync?.errorMessage" class="error" style="margin-top:12px">
          {{ data.latestSync.errorMessage }}
        </p>
      </section>
    </template>
  </div>
</template>
