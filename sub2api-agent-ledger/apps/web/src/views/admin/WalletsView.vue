<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '../../api/client';
import { formatMoney, formatTime } from '../../types';

const agents = ref<any[]>([]);
const agentId = ref('');
const amount = ref('10');
const operation = ref<'add' | 'subtract' | 'set'>('add');
const notes = ref('');
const wallet = ref<any>(null);
const transactions = ref<any[]>([]);
const error = ref('');
const message = ref('');

async function loadAgents() {
  const result = await api.agents();
  if (result.code === 'OK') {
    agents.value = (result.data as any[]) || [];
    if (!agentId.value && agents.value[0]) agentId.value = agents.value[0].id;
  }
}

async function loadWallet() {
  if (!agentId.value) return;
  error.value = '';
  const result = await api.walletLedger(agentId.value);
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  wallet.value = (result.data as any)?.wallet;
  transactions.value = (result.data as any)?.transactions || [];
}

async function adjust() {
  message.value = '';
  error.value = '';
  const result = await api.adjustWallet(agentId.value, {
    operation: operation.value,
    amount: amount.value,
    notes: notes.value,
    idempotencyKey: `ui-${agentId.value}-${operation.value}-${Date.now()}`,
  });
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  message.value = (result.data as any)?.replayed ? '幂等重放，余额未重复变更' : '余额已更新';
  await loadWallet();
}

onMounted(async () => {
  await loadAgents();
  await loadWallet();
});

watch(agentId, loadWallet);
</script>

<template>
  <div>
    <h1 class="page-title">钱包与账本</h1>
    <section class="panel stack">
      <div class="grid-2">
        <label>
          代理商
          <select v-model="agentId">
            <option v-for="agent in agents" :key="agent.id" :value="agent.id">
              {{ agent.name }}
            </option>
          </select>
        </label>
        <label>
          操作
          <select v-model="operation">
            <option value="add">增加</option>
            <option value="subtract">减少</option>
            <option value="set">设置为</option>
          </select>
        </label>
        <label>
          金额
          <input v-model="amount" class="mono" />
        </label>
        <label>
          备注
          <input v-model="notes" />
        </label>
      </div>
      <div class="row-actions">
        <button type="button" @click="adjust">提交调整</button>
        <span v-if="wallet" class="source-chip local">本地 {{ formatMoney(wallet.balanceMinor) }}</span>
      </div>
      <p v-if="message" class="success">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section class="panel">
      <h2 class="section-title">流水时间线</h2>
      <div v-if="!transactions.length" class="empty">暂无流水</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>金额</th>
              <th>前</th>
              <th>后</th>
              <th>幂等键</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tx in transactions" :key="tx.id">
              <td class="mono">{{ formatTime(tx.createdAt) }}</td>
              <td>{{ tx.type }}</td>
              <td class="mono">{{ formatMoney(tx.amountMinor) }}</td>
              <td class="mono">{{ formatMoney(tx.balanceBefore) }}</td>
              <td class="mono">{{ formatMoney(tx.balanceAfter) }}</td>
              <td class="mono">{{ tx.idempotencyKey }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
