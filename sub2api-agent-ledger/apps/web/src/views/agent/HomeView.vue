<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api/client';
import { formatMoney, formatTime, formatUsageMoney } from '../../types';

const users = ref<any[]>([]);
const wallet = ref<any>(null);
const transactions = ref<any[]>([]);
const selected = ref<any>(null);
const usage = ref<any[]>([]);
const code = ref('');
const error = ref('');
const message = ref('');
const loading = ref(false);
const issueCount = ref(1);
const issueValue = ref('10');
const issuedCards = ref<any[]>([]);
const issuing = ref(false);
const issueKey = ref(newIdempotencyKey());

function newIdempotencyKey(): string {
  return `agent-issue-${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
}

async function load() {
  loading.value = true;
  error.value = '';
  const [usersResult, walletResult] = await Promise.all([
    api.agentUsers(),
    api.agentWallet(),
  ]);
  loading.value = false;
  if (usersResult.code !== 'OK') {
    error.value = usersResult.message;
    return;
  }
  if (walletResult.code !== 'OK') {
    error.value = walletResult.message;
    return;
  }
  users.value = (usersResult.data as any)?.users || [];
  wallet.value = (walletResult.data as any)?.wallet;
  transactions.value = (walletResult.data as any)?.transactions || [];
}

async function openUser(user: any) {
  selected.value = null;
  usage.value = [];
  const result = await api.agentUser(user.mainUserId, true);
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  selected.value = result.data;
  usage.value = (result.data as any)?.usage || [];
}

async function redeem() {
  message.value = '';
  error.value = '';
  const result = await api.redeemCard(code.value, `agent-redeem-${Date.now()}`);
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  message.value = (result.data as any)?.replayed ? '卡密已核销过，余额未重复增加' : '核销成功';
  code.value = '';
  await load();
}

async function issueCards() {
  if (issuing.value) return;
  const valueMinor = Math.round(Number(issueValue.value) * 100);
  if (!Number.isInteger(valueMinor) || valueMinor <= 0) {
    error.value = '请输入有效卡密面值';
    return;
  }
  issuing.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api.issueAgentCards({
      count: Number(issueCount.value),
      valueMinor,
      idempotencyKey: issueKey.value,
    });
    if (result.code !== 'OK') {
      error.value = result.message;
      return;
    }
    const data = result.data as any;
    issuedCards.value = data?.cards || [];
    message.value = data?.replayed ? '该请求已处理，未重复扣款或发卡' : '卡密已创建，请立即导出明文';
    if (!data?.replayed) issueKey.value = newIdempotencyKey();
    await load();
  } finally {
    issuing.value = false;
  }
}

function downloadIssuedCards() {
  const text = issuedCards.value.map((card) => card.code).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `agent-cards-${Date.now()}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="page-title">代理商工作台</h1>
    <section class="grid-2">
      <div class="panel stack">
        <h2 class="section-title">本地钱包 <span class="source-chip local">本地</span></h2>
        <div class="stat-value">{{ formatMoney(wallet?.balanceMinor || 0) }}</div>
        <form class="form-grid" @submit.prevent="redeem">
          <label>
            核销卡密
            <input v-model="code" class="mono" placeholder="粘贴完整卡密" required />
          </label>
          <button type="submit">核销</button>
        </form>
        <form class="form-grid" @submit.prevent="issueCards">
          <label>卡密数量<input v-model.number="issueCount" type="number" min="1" max="500" required /></label>
          <label>单张面值<input v-model="issueValue" class="mono" required /></label>
          <button type="submit" :disabled="issuing">{{ issuing ? '创建中…' : '用余额创建卡密' }}</button>
        </form>
        <button v-if="issuedCards.length" class="secondary" type="button" @click="downloadIssuedCards">下载本次明文卡密</button>
        <p v-if="message" class="success">{{ message }}</p>
        <p v-if="error" class="error">{{ error }}</p>
      </div>
      <div class="panel">
        <h2 class="section-title">最近流水</h2>
        <div v-if="!transactions.length" class="empty">暂无流水</div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>后余额</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tx in transactions.slice(0, 8)" :key="tx.id">
                <td class="mono">{{ formatTime(tx.createdAt) }}</td>
                <td>{{ tx.type }}</td>
                <td class="mono">{{ formatMoney(tx.balanceAfter) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="panel" style="margin-top:16px">
      <h2 class="section-title">旗下用户 <span class="source-chip remote">远程</span></h2>
      <p v-if="loading" class="muted">加载中…</p>
      <div v-else-if="!users.length" class="empty">暂无绑定用户</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>用户</th>
              <th>远程余额</th>
              <th>新鲜度</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in users" :key="user.mainUserId">
              <td>
                <div>{{ user.remote?.username || user.mainUserId }}</div>
                <div class="muted mono">{{ user.mainUserId }}</div>
              </td>
              <td class="mono">
                {{ user.remote ? formatMoney(user.remote.balanceMinor) : '—' }}
              </td>
              <td class="mono">
                {{ user.remote ? formatTime(user.remote.observedAt) : '无缓存' }}
                <span v-if="user.remote?.isStale" class="muted"> · stale</span>
              </td>
              <td>
                <button class="secondary" type="button" @click="openUser(user)">详情</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="selected" class="panel" style="margin-top:16px">
      <h2 class="section-title">用户详情</h2>
      <div class="row-actions" style="margin-bottom:12px">
        <span class="source-chip remote">远程</span>
        <span class="mono">{{ selected.remote?.username || selected.assignment?.mainUserId }}</span>
        <span class="muted mono">{{ formatTime(selected.remote?.observedAt) }}</span>
      </div>
      <p v-if="selected.remoteError" class="error">刷新失败：{{ selected.remoteError }}</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>模型</th>
              <th>tokens</th>
              <th>金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in usage" :key="item.id || item.remoteRecordId">
              <td class="mono">{{ formatTime(item.occurredAt) }}</td>
              <td>{{ item.model }}</td>
              <td class="mono">{{ item.tokens }}</td>
              <td class="mono">{{ formatUsageMoney(item.amountMicro) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
