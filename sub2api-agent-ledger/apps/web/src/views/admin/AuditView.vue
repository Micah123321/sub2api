<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api/client';
import { formatTime } from '../../types';
import PaginationControls from '../../components/PaginationControls.vue';

const logs = ref<any[]>([]);
const error = ref('');
const loading = ref(true);
const page = ref(1);
const pageSize = 25;
const total = ref(0);

async function load(nextPage = page.value) {
  page.value = nextPage;
  loading.value = true;
  error.value = '';
  try {
    const result = await api.auditLogs(page.value, pageSize);
    if (result.code !== 'OK') {
      error.value = result.message;
      return;
    }
    const data = result.data as any;
    logs.value = data?.items || [];
    total.value = data?.total || 0;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
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
      <PaginationControls v-if="!error" :page="page" :page-size="pageSize" :total="total" :disabled="loading" @change="load" />
    </section>
  </div>
</template>
