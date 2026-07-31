<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();
const router = useRouter();

const links = computed(() => {
  if (session.isAdmin) {
    return [
      { to: '/admin', label: '总览' },
      { to: '/admin/settings', label: '主服务' },
      { to: '/admin/agents', label: '代理商' },
      { to: '/admin/bindings', label: '用户绑定' },
      { to: '/admin/wallets', label: '钱包账本' },
      { to: '/admin/cards', label: '卡密' },
      { to: '/admin/audit', label: '审计' },
    ];
  }
  return [{ to: '/agent', label: '我的工作台' }];
});

async function logout() {
  await session.logout();
  await router.push('/login');
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">Agent Ledger</div>
      <nav class="nav-list">
        <RouterLink
          v-for="link in links"
          :key="link.to"
          class="nav-link"
          :to="link.to"
        >
          {{ link.label }}
        </RouterLink>
      </nav>
      <div class="muted" style="margin-top:auto;font-size:12px;letter-spacing:-0.12px;padding:0 12px">
        {{ session.user?.role }} · {{ session.user?.userId?.slice(0, 8) }}
      </div>
    </aside>
    <div class="main-column">
      <header class="topbar">
        <div class="row-actions">
          <span class="source-chip remote">远程主服务</span>
          <span class="source-chip local">本地账本</span>
        </div>
        <div class="row-actions">
          <span class="muted mono" style="font-size:14px">{{ session.user?.role }}</span>
          <button class="secondary" type="button" @click="logout">退出</button>
        </div>
      </header>
      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>
