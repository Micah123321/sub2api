/// <reference types="vite/client" />

export interface ApiEnvelope<T> {
  code: string;
  message: string;
  data?: T;
  requestId: string;
}

export interface SessionUser {
  userId: string;
  role: 'ADMIN' | 'AGENT';
  agentId: string | null;
}

export interface AgentSummary {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  notes: string;
  walletBalanceMinor: number;
  activeBindings: number;
  loginUsername: string | null;
}

export interface CachedRemoteUser {
  mainUserId: string;
  username: string;
  email: string;
  status: string;
  balanceMinor: number;
  currency: string;
  observedAt: number;
  syncStatus: string;
  isStale: boolean;
  source: 'remote';
  lastError: string | null;
}

export function formatMoney(minor: number, currency = 'USD'): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}${major}.${rest} ${currency}`;
}

/** 主服务用量金额以微美元（1e-6 USD）存储，单条调用常在 1e-5 量级，
 *  按「分」展示会全部变成 0.00，因此小额保留 6 位小数。 */
export function formatUsageMoney(micro: number, currency = 'USD'): string {
  const major = (micro ?? 0) / 1_000_000;
  const digits = major !== 0 && Math.abs(major) < 0.01 ? 6 : 2;
  return `${major.toFixed(digits)} ${currency}`;
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}
