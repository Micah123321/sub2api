<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api/client';
import { formatMoney } from '../../types';

const agents = ref<any[]>([]);
const loading = ref(true);
const error = ref('');
const form = ref({
  name: '',
  username: '',
  password: '',
  notes: '',
});

async function load() {
  loading.value = true;
  const result = await api.agents();
  loading.value = false;
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  agents.value = (result.data as any[]) || [];
}

async function createAgent() {
  error.value = '';
  const result = await api.createAgent(form.value);
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  form.value = { name: '', username: '', password: '', notes: '' };
  await load();
}

async function toggle(agent: any) {
  const next = agent.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  // 禁用代理商会连带禁用其登录账号，代理商会立刻被踢出，必须先确认。
  if (
    next === 'DISABLED' &&
    !window.confirm(`确认禁用代理商「${agent.name}」？其登录账号将同时被禁用，无法再登录。`)
  ) {
    return;
  }
  const result = await api.patchAgent(agent.id, { status: next });
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  await load();
}

async function edit(agent: any) {
  const name = window.prompt('代理名称', agent.name);
  if (!name?.trim()) return;
  const notes = window.prompt('备注', agent.notes || '') ?? '';
  const result = await api.patchAgent(agent.id, { name, notes });
  if (result.code !== 'OK') error.value = result.message;
  else await load();
}

async function resetPassword(agent: any) {
  const password = window.prompt(`为「${agent.name}」设置新密码（至少 8 位）`);
  if (!password) return;
  if (!window.confirm('确认重置密码？该代理的所有现有登录会话将失效。')) return;
  const result = await api.resetAgentPassword(agent.id, password);
  if (result.code !== 'OK') error.value = result.message;
  else window.alert('密码已重置，旧会话已失效');
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="page-title">代理商</h1>
    <section class="panel">
      <h2 class="section-title">创建代理商</h2>
      <form class="form-grid" @submit.prevent="createAgent">
        <div class="grid-2">
          <label>名称<input v-model="form.name" required /></label>
          <label>登录用户名<input v-model="form.username" required /></label>
          <label>初始密码<input v-model="form.password" type="password" required /></label>
          <label>备注<input v-model="form.notes" /></label>
        </div>
        <button type="submit">创建</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section class="panel">
      <h2 class="section-title">列表</h2>
      <p v-if="loading" class="muted">加载中…</p>
      <div v-else-if="!agents.length" class="empty">还没有代理商</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>登录名</th>
              <th>状态</th>
              <th>绑定</th>
              <th>本地余额</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="agent in agents" :key="agent.id">
              <td>{{ agent.name }}</td>
              <td class="mono">{{ agent.loginUsername || '—' }}</td>
              <td>{{ agent.status }}</td>
              <td class="mono">{{ agent.activeBindings }}</td>
              <td>
                <span class="source-chip local">本地</span>
                <span class="mono"> {{ formatMoney(agent.walletBalanceMinor) }}</span>
              </td>
              <td>
                <button class="secondary" type="button" @click="edit(agent)">编辑</button>
                <button class="secondary" type="button" @click="resetPassword(agent)">重置密码</button>
                <button
                  :class="agent.status === 'ACTIVE' ? 'danger' : 'secondary'"
                  type="button"
                  @click="toggle(agent)"
                >
                  {{ agent.status === 'ACTIVE' ? '禁用' : '恢复' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
