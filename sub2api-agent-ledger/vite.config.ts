import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'apps/web',
  plugins: [vue()],
  server: {
    port: 4174,
    proxy: {
      '/api': 'http://localhost:4173',
    },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
});
