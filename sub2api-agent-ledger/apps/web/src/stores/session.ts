import { defineStore } from 'pinia';
import { api } from '../api/client';
import type { SessionUser } from '../types';

export const useSessionStore = defineStore('session', {
  state: () => ({
    user: null as SessionUser | null,
    loaded: false,
    error: '' as string,
  }),
  getters: {
    isAdmin: (state) => state.user?.role === 'ADMIN',
    isAgent: (state) => state.user?.role === 'AGENT',
  },
  actions: {
    async refresh() {
      this.error = '';
      try {
        const result = await api.me();
        if (result.code === 'OK' && result.data?.user) {
          this.user = result.data.user;
        } else {
          this.user = null;
        }
      } catch (error) {
        this.user = null;
        this.error = error instanceof Error ? error.message : '会话加载失败';
      } finally {
        this.loaded = true;
      }
    },
    async login(username: string, password: string) {
      this.error = '';
      try {
        const result = await api.login(username, password);
        if (result.code !== 'OK' || !result.data?.user) {
          this.error = result.message || '登录失败';
          this.user = null;
          return false;
        }
        this.user = result.data.user;
        this.loaded = true;
        return true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : '登录失败';
        this.user = null;
        return false;
      }
    },
    async logout() {
      // 即使登出请求失败（网络断开等），本地会话也必须清空，
      // 否则按钮点了没反应、用户停在已失效的界面上。
      try {
        await api.logout();
      } finally {
        this.user = null;
      }
    },
    /** 由 API 层在收到 401 时调用，清空本地会话状态。 */
    clearSession() {
      this.user = null;
      this.loaded = true;
    },
  },
});
