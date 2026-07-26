<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api/client';
import { formatTime } from '../../types';

const logs = ref<any[]>([]);
const error = ref('');
const loading = ref(true);

onMounted(async () => {
  try {
    const result = await api.auditLogs();
    if (result.code !== 'OK') {
      error.value = result.message;
      return;
    }
    logs.value = (result.data as any[]) || [];
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div>
    <h1 class="page-title">审计日志</h1>
    <section class="panel">
      <p v-if="error" class="error">{{ error }}</p>
      <div v-else-if="loading" class="empty">加载中…</div>
      <div v-else-if="!logs.length" class="empty">暂无审计记录</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>动作</th>
              <th>资源</th>
              <th>操作者</th>
              <th>requestId</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in logs" :key="log.id">
              <td class="mono">{{ formatTime(log.createdAt) }}</td>
              <td>{{ log.action }}</td>
              <td class="mono">{{ log.resourceType }} {{ log.resourceId || '' }}</td>
              <td class="mono">{{ log.actorRole }} {{ log.actorId || '' }}</td>
              <td class="mono">{{ log.requestId }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
