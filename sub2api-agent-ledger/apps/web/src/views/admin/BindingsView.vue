<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api/client';
import { formatMoney, formatTime } from '../../types';

const agents = ref<any[]>([]);
const users = ref<any[]>([]);
const selectedAgentId = ref('');
const selectedIds = ref<string[]>([]);
const search = ref('');
const transfer = ref(false);
const loading = ref(false);
const results = ref<any[]>([]);
const error = ref('');
const message = ref('');

const selectedCount = computed(() => selectedIds.value.length);

async function loadAgents() {
  const result = await api.agents();
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  agents.value = (result.data as any[]) || [];
  if (!selectedAgentId.value && agents.value[0]) {
    selectedAgentId.value = agents.value[0].id;
  }
}

async function loadUsers(refresh = false) {
  loading.value = true;
  error.value = '';
  const result = await api.remoteUsers(search.value, refresh);
  loading.value = false;
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  const data = result.data as any;
  users.value = Array.isArray(data?.users) ? data.users : [];
}

function toggle(id: string) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((item) => item !== id);
  } else {
    selectedIds.value = [...selectedIds.value, id];
  }
}

async function bind() {
  if (!selectedAgentId.value || !selectedIds.value.length) {
    error.value = '请选择代理商和用户';
    return;
  }
  message.value = '';
  error.value = '';
  // transfer 会把用户从原代理商名下夺走，属于影响他人账本归属的操作，先确认。
  if (
    transfer.value &&
    !window.confirm(
      `确认转移 ${selectedIds.value.length} 个用户？已绑定到其他代理商的用户将被解绑并改绑到当前代理商。`,
    )
  ) {
    return;
  }
  const result = await api.batchAssign({
    agentId: selectedAgentId.value,
    mainUserIds: selectedIds.value,
    transfer: transfer.value,
  });
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  results.value = (result.data as any)?.results || [];
  message.value = '批量绑定完成，请查看逐项结果';
  selectedIds.value = [];
}

onMounted(async () => {
  await loadAgents();
  await loadUsers(false);
});
</script>

<template>
  <div>
    <h1 class="page-title">用户绑定</h1>
    <section class="panel stack">
      <div class="grid-2">
        <label>
          目标代理商
          <select v-model="selectedAgentId">
            <option v-for="agent in agents" :key="agent.id" :value="agent.id">
              {{ agent.name }}
            </option>
          </select>
        </label>
        <label>
          搜索主服务用户
          <input v-model="search" placeholder="邮箱 / 用户名 / ID" @keyup.enter="loadUsers(false)" />
        </label>
      </div>
      <label style="display:flex;align-items:center;gap:8px">
        <input v-model="transfer" type="checkbox" />
        显式允许从其他代理商转移
      </label>
      <div class="row-actions">
        <button class="secondary" type="button" :disabled="loading" @click="loadUsers(false)">读取缓存</button>
        <button type="button" :disabled="loading" @click="loadUsers(true)">刷新远程</button>
        <button type="button" :disabled="!selectedCount" @click="bind">
          绑定已选 ({{ selectedCount }})
        </button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="message" class="success">{{ message }}</p>
    </section>

    <section class="panel">
      <h2 class="section-title">用户池 <span class="source-chip remote">远程</span></h2>
      <div v-if="loading" class="muted">加载中…</div>
      <div v-else-if="!users.length" class="empty">没有用户缓存，请先刷新远程</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>用户</th>
              <th>状态</th>
              <th>远程余额</th>
              <th>观察时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in users" :key="user.mainUserId">
              <td>
                <input
                  type="checkbox"
                  :checked="selectedIds.includes(user.mainUserId)"
                  @change="toggle(user.mainUserId)"
                />
              </td>
              <td>
                <div>{{ user.username || user.email || user.mainUserId }}</div>
                <div class="muted mono">{{ user.mainUserId }}</div>
              </td>
              <td>
                {{ user.status }}
                <span v-if="user.isStale" class="muted"> · stale</span>
              </td>
              <td class="mono">{{ formatMoney(user.balanceMinor, user.currency) }}</td>
              <td class="mono">{{ formatTime(user.observedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="results.length" class="panel">
      <h2 class="section-title">绑定结果</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>用户</th>
              <th>状态</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in results" :key="item.mainUserId + item.status">
              <td class="mono">{{ item.mainUserId }}</td>
              <td>{{ item.status }}</td>
              <td>{{ item.message }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
