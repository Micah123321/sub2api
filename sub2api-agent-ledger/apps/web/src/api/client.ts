import type { ApiEnvelope } from '../types';

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('X-Requested-With')) {
    headers.set('X-Requested-With', 'sub2api-agent-ledger');
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });
  const json = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok && json.code === 'OK') {
    return {
      code: 'HTTP_ERROR',
      message: `HTTP ${response.status}`,
      requestId: json.requestId,
    };
  }
  return json;
}

export const api = {
  login(username: string, password: string) {
    return request<{ user: { userId: string; role: 'ADMIN' | 'AGENT'; agentId: string | null } }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      },
    );
  },
  logout() {
    return request('/api/auth/logout', { method: 'POST' });
  },
  me() {
    return request<{ user: { userId: string; role: 'ADMIN' | 'AGENT'; agentId: string | null } }>(
      '/api/auth/me',
    );
  },
  overview() {
    return request<Record<string, unknown>>('/api/admin/overview');
  },
  settings() {
    return request<Record<string, unknown>>('/api/settings/main-service');
  },
  saveSettings(body: { baseUrl: string; apiKey?: string }) {
    return request('/api/settings/main-service', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },
  testSettings(body: { baseUrl?: string; apiKey?: string }) {
    return request('/api/settings/main-service/test', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  agents() {
    return request('/api/admin/agents');
  },
  createAgent(body: { name: string; username: string; password: string; notes?: string }) {
    return request('/api/admin/agents', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  patchAgent(id: string, status: 'ACTIVE' | 'DISABLED') {
    return request(`/api/admin/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
  remoteUsers(search = '', refresh = false) {
    const query = new URLSearchParams();
    if (search) query.set('search', search);
    if (refresh) query.set('refresh', '1');
    return request(`/api/admin/remote-users?${query.toString()}`);
  },
  batchAssign(body: {
    agentId: string;
    mainUserIds: string[];
    transfer?: boolean;
    notes?: string;
  }) {
    return request('/api/admin/assignments/batch', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  wallet(agentId: string) {
    return request(`/api/admin/wallets/${agentId}`);
  },
  adjustWallet(
    agentId: string,
    body: {
      operation: 'add' | 'subtract' | 'set';
      amount: number | string;
      idempotencyKey: string;
      notes?: string;
    },
  ) {
    return request(`/api/admin/wallets/${agentId}/adjust`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  walletLedger(agentId: string) {
    return request(`/api/admin/wallets/${agentId}/ledger`);
  },
  createCards(body: { agentId: string; count: number; value: number | string }) {
    return request('/api/admin/cards/batches', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  cards(agentId?: string) {
    const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
    return request(`/api/admin/cards${query}`);
  },
  auditLogs() {
    return request('/api/admin/audit-logs');
  },
  agentUsers() {
    return request('/api/agent/users');
  },
  agentUser(userId: string, refresh = false) {
    const query = refresh ? '?refresh=1' : '';
    return request(`/api/agent/users/${userId}${query}`);
  },
  agentWallet() {
    return request('/api/agent/wallet');
  },
  redeemCard(code: string, idempotencyKey: string) {
    return request('/api/agent/cards/redeem', {
      method: 'POST',
      body: JSON.stringify({ code, idempotencyKey }),
    });
  },
};
