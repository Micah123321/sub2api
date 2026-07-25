<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';

const username = ref(import.meta.env.DEV ? 'admin' : '');
const password = ref('');
const loading = ref(false);
const session = useSessionStore();
const router = useRouter();

async function submit() {
  loading.value = true;
  try {
    const ok = await session.login(username.value.trim(), password.value);
    if (!ok) return;
    await router.push(session.isAdmin ? '/admin' : '/agent');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="shell">
    <section class="intro-panel">
      <p class="eyebrow">AGENT LEDGER</p>
      <h1>登录账本工作台</h1>
      <p class="intro-copy">独立插件登录。不会向浏览器暴露主服务 Admin API Key。</p>
      <form class="form-grid" style="margin-top:24px" @submit.prevent="submit">
        <label>
          用户名
          <input v-model="username" autocomplete="username" required />
        </label>
        <label>
          密码
          <input v-model="password" type="password" autocomplete="current-password" required />
        </label>
        <p v-if="session.error" class="error">{{ session.error }}</p>
        <button type="submit" :disabled="loading">
          {{ loading ? '登录中…' : '登录' }}
        </button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}
.intro-panel {
  width: min(480px, 100%);
  padding: 36px;
  border: 1px solid var(--line);
  background: var(--surface);
}
.eyebrow {
  margin: 0 0 12px;
  color: var(--local);
  font-family: "IBM Plex Mono", monospace;
  letter-spacing: 0.12em;
  font-size: 12px;
}
h1 {
  margin: 0;
  font-size: 34px;
  line-height: 1.1;
}
.intro-copy {
  margin: 14px 0 0;
  color: var(--muted);
}
</style>
