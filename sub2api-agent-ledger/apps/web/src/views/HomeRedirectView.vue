<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();
const router = useRouter();

onMounted(async () => {
  if (!session.loaded) {
    await session.refresh();
  }
  await router.replace(session.isAdmin ? '/admin' : '/agent');
});
</script>

<template>
  <p class="muted">正在进入工作台…</p>
</template>
