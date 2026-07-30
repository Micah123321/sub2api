<script setup lang="ts">
defineProps<{ page: number; pageSize: number; total: number; disabled?: boolean }>();
const emit = defineEmits<{ change: [page: number] }>();
</script>

<template>
  <div class="row-actions pagination-controls">
    <span class="muted mono">{{ total }} 条 · 第 {{ page }} / {{ Math.max(1, Math.ceil(total / pageSize)) }} 页</span>
    <button class="secondary" type="button" :disabled="disabled || page <= 1" @click="emit('change', page - 1)">上一页</button>
    <button class="secondary" type="button" :disabled="disabled || page * pageSize >= total" @click="emit('change', page + 1)">下一页</button>
  </div>
</template>
