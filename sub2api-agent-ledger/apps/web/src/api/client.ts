import type { ApiEnvelope } from '../types';

/** 会话失效时由 session store 注册，用于跳回登录页。 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('X-Requested-With')) {
    headers.set('X-Requested-With', 'sub2api-agent-ledger');
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch {
    // 网络不可达/请求被中断：必须返回错误信封，否则调用方的 loading 永远不会复位。
    return { code: 'NETWORK_ERROR', message: '无法连接服务，请检查网络后重试', requestId: '' };
  }

  // 网关 502、HTML 错误页等非 JSON 响应会让 response.json() 抛错。
  let json: ApiEnvelope<T> | null = null;
  try {
    json = (await response.json()) as ApiEnvelope<T>;
  } catch {
    json = null;
  }

  // /api/auth/me 的 401 表示「当前未登录」，是会话探测的正常结果，
  // 由路由守卫决定去向；这里只处理已登录后中途失效的情况。
  const isSessionProbe = path === '/api/auth/me' || path === '/api/auth/login';
  if (response.status === 401 && !isSessionProbe) {
    onUnauthorized?.();
    return {
      code: 'SESSION_EXPIRED',
      message: json?.message || '登录状态已失效，请重新登录',
      requestId: json?.requestId ?? '',
    };
  }

  if (!json) {
    return {
      code: 'PARSE_ERROR',
      message: `服务响应异常（HTTP ${response.status}）`,
      requestId: '',
    };
  }

  // Nest 默认 404/500 响应体没有 code 字段，直接透出会把英文原文渲染给用户。
  if (!json.code) {
    return {
      code: 'HTTP_ERROR',
      message: response.ok ? '服务响应格式异常' : `请求失败（HTTP ${response.status}）`,
      requestId: json.requestId ?? '',
    };
  }

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
  saveSettings(body: { baseUrl: string; adminEmail?: string; adminPassword?: string }) {
    return request('/api/settings/main-service', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },
  testSettings(body: { baseUrl?: string; adminEmail?: string; adminPassword?: string }) {
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
  patchAgent(id: string, body: { status?: 'ACTIVE' | 'DISABLED'; name?: string; notes?: string }) {
    return request(`/api/admin/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  resetAgentPassword(id: string, password: string) {
    return request(`/api/admin/agents/${id}/password-reset`, { method: 'POST', body: JSON.stringify({ password }) });
  },
  remoteUsers(search = '', refresh = false, page = 1, pageSize = 25) {
    const query = new URLSearchParams();
    if (search) query.set('search', search);
    if (refresh) query.set('refresh', '1');
    query.set('page', String(page));
    query.set('pageSize', String(pageSize));
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
  assignmentHistory(page = 1, pageSize = 25) {
    return request(`/api/admin/assignments/history?page=${page}&pageSize=${pageSize}`);
  },
  unbindAssignment(id: string) {
    return request(`/api/admin/assignments/${id}/unbind`, { method: 'POST' });
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
  walletLedger(agentId: string, page = 1, pageSize = 25) {
    return request(`/api/admin/wallets/${agentId}/ledger?page=${page}&pageSize=${pageSize}`);
  },
  createCards(body: { agentId: string; count: number; value: number | string; idempotencyKey: string }) {
    return request('/api/admin/cards/batches', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  cards(agentId?: string, page = 1, pageSize = 25, batchPage = 1) {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (agentId) query.set('agentId', agentId);
    query.set('batchPage', String(batchPage));
    return request(`/api/admin/cards?${query.toString()}`);
  },
  revokeCard(id: string) {
    return request(`/api/admin/cards/${id}/revoke`, { method: 'POST' });
  },
  auditLogs(page = 1, pageSize = 25) {
    return request(`/api/admin/audit-logs?page=${page}&pageSize=${pageSize}`);
  },
  agentUsers(page = 1, pageSize = 25) {
    return request(`/api/agent/users?page=${page}&pageSize=${pageSize}`);
  },
  agentUser(userId: string, refresh = false, page = 1, pageSize = 25) {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (refresh) query.set('refresh', '1');
    return request(`/api/agent/users/${userId}?${query.toString()}`);
  },
  agentWallet(page = 1, pageSize = 25) {
    return request(`/api/agent/wallet?page=${page}&pageSize=${pageSize}`);
  },
  redeemCard(code: string, idempotencyKey: string) {
    return request('/api/agent/cards/redeem', {
      method: 'POST',
      body: JSON.stringify({ code, idempotencyKey }),
    });
  },
  issueAgentCards(body: { count: number; valueMinor: number; idempotencyKey: string }) {
    return request('/api/agent/cards/batches', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};
