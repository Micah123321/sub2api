<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api/client';
import { formatMoney, formatTime } from '../../types';

const users = ref<any[]>([]);
const wallet = ref<any>(null);
const transactions = ref<any[]>([]);
const selected = ref<any>(null);
const usage = ref<any[]>([]);
const code = ref('');
const error = ref('');
const message = ref('');
const loading = ref(false);

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
              <td class="mono">{{ formatMoney(item.amountMinor) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
