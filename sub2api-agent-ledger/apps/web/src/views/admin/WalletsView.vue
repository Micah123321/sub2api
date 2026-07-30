<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '../../api/client';
import { formatMoney, formatTime } from '../../types';
import PaginationControls from '../../components/PaginationControls.vue';

const agents = ref<any[]>([]);
const agentId = ref('');
const amount = ref('10');
const operation = ref<'add' | 'subtract' | 'set'>('add');
const notes = ref('');
const wallet = ref<any>(null);
const transactions = ref<any[]>([]);
const error = ref('');
const message = ref('');
const submitting = ref(false);
// 幂等键必须在「同一笔调整」内保持稳定，否则重复点击会被服务端当成两笔不同的调整入账；
// 但也不能跨笔复用：服务端的幂等冲突校验只比对 type/amount/relatedCardId，不含备注，
// 两笔金额相同、仅备注不同的调整会被静默判为重放，第二笔真实入账就被吞掉。
// 因此用「每笔一个随机 token，提交成功后才换新」，与表单字段无关。
function newIdempotencyKey(): string {
  // randomUUID 仅在安全上下文可用；本服务默认以 HTTP 暴露在局域网，
  // 此时 crypto.randomUUID 为 undefined，必须有回退，否则每次提交都抛错。
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ui-${crypto.randomUUID()}`;
  }
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
const idempotencyKey = ref(newIdempotencyKey());
const page = ref(1);
const pageSize = 25;
const total = ref(0);

async function loadAgents() {
  const result = await api.agents();
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  agents.value = (result.data as any[]) || [];
  if (!agentId.value && agents.value[0]) agentId.value = agents.value[0].id;
}

async function loadWallet(nextPage = page.value) {
  if (!agentId.value) return;
  page.value = nextPage;
  error.value = '';
  const result = await api.walletLedger(agentId.value, page.value, pageSize);
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  wallet.value = (result.data as any)?.wallet;
  const data = result.data as any;
  transactions.value = data?.transactions?.items || [];
  total.value = data?.transactions?.total || 0;
}

async function adjust() {
  if (submitting.value) return;
  // 「设置为」直接覆盖余额而非增减，误操作无法从金额上看出来，先确认。
  if (
    operation.value === 'set' &&
    !window.confirm(`确认把该代理商余额直接覆盖为 ${amount.value}？当前余额将被替换，不是增减。`)
  ) {
    return;
  }
  message.value = '';
  error.value = '';
  submitting.value = true;
  try {
    const result = await api.adjustWallet(agentId.value, {
      operation: operation.value,
      amount: amount.value,
      notes: notes.value,
      idempotencyKey: idempotencyKey.value,
    });
    if (result.code !== 'OK') {
      error.value = result.message;
      return;
    }
    message.value = (result.data as any)?.replayed ? '幂等重放，余额未重复变更' : '余额已更新';
    // 本笔已成功入账，换新 token，下一笔调整不会被误判为重放。
    idempotencyKey.value = newIdempotencyKey();
    await loadWallet();
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  await loadAgents();
});

watch(agentId, () => void loadWallet(1));
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
        <button type="button" :disabled="submitting" @click="adjust">
          {{ submitting ? '提交中…' : '提交调整' }}
        </button>
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
      <PaginationControls :page="page" :page-size="pageSize" :total="total" @change="loadWallet" />
    </section>
  </div>
</template>
