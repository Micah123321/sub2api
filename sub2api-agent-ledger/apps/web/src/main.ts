import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { setUnauthorizedHandler } from './api/client';
import { router } from './router';
import { useSessionStore } from './stores/session';
import './styles.css';

const pinia = createPinia();
const app = createApp(App).use(pinia).use(router);

// 会话中途失效时清空本地状态并跳回登录页；否则用户会停在一个只剩报错的空页面上。
setUnauthorizedHandler(() => {
  const session = useSessionStore(pinia);
  // 首次加载时的 /api/auth/me 401 属于「未登录」而非「会话过期」，
  // 此时路由守卫自己会跳转，这里再跳一次会和守卫的导航互相打断。
  const wasLoaded = session.loaded;
  session.clearSession();
  if (wasLoaded && router.currentRoute.value.path !== '/login') {
    void router.replace('/login');
  }
});

app.mount('#app');
