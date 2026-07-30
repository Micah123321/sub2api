<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api/client';
import { formatMoney, formatTime } from '../../types';
import PaginationControls from '../../components/PaginationControls.vue';

const agents = ref<any[]>([]);
const agentId = ref('');
const count = ref(5);
const value = ref('10');
const cards = ref<any[]>([]);
const batches = ref<any[]>([]);
const plaintext = ref<any[]>([]);
const error = ref('');
const message = ref('');
const loading = ref(true);
const submitting = ref(false);
const cardsPage = ref(1);
const batchesPage = ref(1);
const pageSize = 25;
const cardsTotal = ref(0);
const batchesTotal = ref(0);

function createIdempotencyKey() {
  return `admin-card-${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
}

async function load(nextCardsPage = cardsPage.value, nextBatchesPage = batchesPage.value) {
  cardsPage.value = nextCardsPage;
  batchesPage.value = nextBatchesPage;
  loading.value = true;
  error.value = '';
  try {
    const agentResult = await api.agents();
    if (agentResult.code !== 'OK') {
      error.value = agentResult.message;
      return;
    }
    agents.value = (agentResult.data as any[]) || [];
    if (!agentId.value && agents.value[0]) agentId.value = agents.value[0].id;

    const result = await api.cards(agentId.value || undefined, cardsPage.value, pageSize, batchesPage.value);
    if (result.code !== 'OK') {
      error.value = result.message;
      return;
    }
    const data = result.data as any;
    cards.value = data?.cards?.items || [];
    batches.value = data?.batches?.items || [];
    cardsTotal.value = data?.cards?.total || 0;
    batchesTotal.value = data?.batches?.total || 0;
  } finally {
    loading.value = false;
  }
}

async function createBatch() {
  if (submitting.value) return;
  error.value = '';
  message.value = '';
  plaintext.value = [];
  submitting.value = true;
  try {
    const result = await api.createCards({
      agentId: agentId.value,
      count: Number(count.value),
      value: value.value,
      idempotencyKey: createIdempotencyKey(),
    });
    if (result.code !== 'OK') {
      error.value = result.message;
      return;
    }
    plaintext.value = (result.data as any)?.cards || [];
    message.value = '批次已生成。明文卡密仅此时可见，请立即导出。';
    await load();
  } finally {
    submitting.value = false;
  }
}

async function revoke(card: any) {
  if (!window.confirm(`确认作废卡密 ${card.displayMask}？作废不会退款。`)) return;
  const result = await api.revokeCard(card.id);
  if (result.code !== 'OK') {
    error.value = result.message;
    return;
  }
  message.value = '卡密已作废';
  await load();
}

/** 切换代理商时必须清空明文，否则界面上显示的是上一个代理商的卡密，容易发错。 */
function onAgentChange() {
  plaintext.value = [];
  message.value = '';
  void load(1, 1);
}

function exportPlaintext() {
  const text = plaintext.value.map((item) => item.code).join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cards-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="page-title">卡密中心</h1>
    <section class="panel stack">
      <div class="grid-3">
        <label>
          代理商
          <select v-model="agentId" @change="onAgentChange">
            <option v-for="agent in agents" :key="agent.id" :value="agent.id">
              {{ agent.name }}
            </option>
          </select>
        </label>
        <label>
          数量
          <input v-model.number="count" type="number" min="1" max="500" />
        </label>
        <label>
          面值
          <input v-model="value" class="mono" />
        </label>
      </div>
      <div class="row-actions">
        <button type="button" :disabled="submitting" @click="createBatch">
          {{ submitting ? '生成中…' : '生成批次' }}
        </button>
        <button
          v-if="plaintext.length"
          class="secondary"
          type="button"
          @click="exportPlaintext"
        >
          导出明文
        </button>
      </div>
      <p v-if="message" class="success">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <div v-if="plaintext.length" class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>明文卡密（一次性）</th>
              <th>脱敏</th>
              <th>面值</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="card in plaintext" :key="card.id">
              <td class="mono">{{ card.code }}</td>
              <td class="mono">{{ card.displayMask }}</td>
              <td class="mono">{{ formatMoney(card.valueMinor) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h2 class="section-title">批次</h2>
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="!batches.length" class="empty">暂无批次</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>批次</th>
              <th>数量</th>
              <th>面值</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="batch in batches" :key="batch.id">
              <td class="mono">{{ batch.id }}</td>
              <td class="mono">{{ batch.count }}</td>
              <td class="mono">{{ formatMoney(batch.valueMinor) }}</td>
              <td class="mono">{{ formatTime(batch.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationControls :page="batchesPage" :page-size="pageSize" :total="batchesTotal" :disabled="loading" @change="(next) => load(cardsPage, next)" />
    </section>

    <section class="panel">
      <h2 class="section-title">卡密状态</h2>
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="!cards.length" class="empty">暂无卡密</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>脱敏</th>
              <th>状态</th>
              <th>面值</th>
              <th>核销时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="card in cards" :key="card.id">
              <td class="mono">{{ card.displayMask }}</td>
              <td>{{ card.status }}</td>
              <td class="mono">{{ formatMoney(card.valueMinor) }}</td>
              <td class="mono">{{ formatTime(card.redeemedAt) }}</td>
              <td>
                <button v-if="card.status === 'ACTIVE'" class="danger" type="button" @click="revoke(card)">作废</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationControls :page="cardsPage" :page-size="pageSize" :total="cardsTotal" :disabled="loading" @change="(next) => load(next, batchesPage)" />
    </section>
  </div>
</template>
