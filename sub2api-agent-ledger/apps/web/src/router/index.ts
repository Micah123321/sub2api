import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useSessionStore } from '../stores/session';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('../layouts/AppLayout.vue'),
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('../views/HomeRedirectView.vue'),
      },
      {
        path: 'admin',
        name: 'admin-overview',
        component: () => import('../views/admin/OverviewView.vue'),
        meta: { role: 'ADMIN' },
      },
      {
        path: 'admin/settings',
        name: 'admin-settings',
        component: () => import('../views/admin/SettingsView.vue'),
        meta: { role: 'ADMIN' },
      },
      {
        path: 'admin/agents',
        name: 'admin-agents',
        component: () => import('../views/admin/AgentsView.vue'),
        meta: { role: 'ADMIN' },
      },
      {
        path: 'admin/bindings',
        name: 'admin-bindings',
        component: () => import('../views/admin/BindingsView.vue'),
        meta: { role: 'ADMIN' },
      },
      {
        path: 'admin/wallets',
        name: 'admin-wallets',
        component: () => import('../views/admin/WalletsView.vue'),
        meta: { role: 'ADMIN' },
      },
      {
        path: 'admin/cards',
        name: 'admin-cards',
        component: () => import('../views/admin/CardsView.vue'),
        meta: { role: 'ADMIN' },
      },
      {
        path: 'admin/audit',
        name: 'admin-audit',
        component: () => import('../views/admin/AuditView.vue'),
        meta: { role: 'ADMIN' },
      },
      {
        path: 'agent',
        name: 'agent-home',
        component: () => import('../views/agent/HomeView.vue'),
        meta: { role: 'AGENT' },
      },
    ],
  },
  {
    // 无匹配路由时回落到首页重定向，避免渲染出只有侧栏的空白页。
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const session = useSessionStore();
  if (!session.loaded) {
    await session.refresh();
  }
  if (to.meta.public) {
    if (session.user && to.name === 'login') {
      return session.isAdmin ? '/admin' : '/agent';
    }
    return true;
  }
  if (!session.user) {
    return '/login';
  }
  if (to.meta.role === 'ADMIN' && !session.isAdmin) {
    return '/agent';
  }
  if (to.meta.role === 'AGENT' && session.isAdmin) {
    // 管理员没有 agentId，调 /api/agent/* 必然 403，页面只剩报错。
    // 代理商视角需要显式的 agentId 选择器，未实现前直接送回管理端。
    return '/admin';
  }
  if (to.meta.role === 'AGENT' && !session.isAgent && !session.isAdmin) {
    return '/login';
  }
  return true;
});
