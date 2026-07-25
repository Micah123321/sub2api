import {
  mainServiceEnvelopeSchema,
  mainServicePaginatedSchema,
  mainServiceUsageLogSchema,
  mainServiceUserSchema,
  type MainServiceUsageLog,
  type MainServiceUser,
} from './schemas';
import { parseMajorToMinor } from '../common/money';

export type RemoteErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'INVALID_RESPONSE'
  | 'SERVER_ERROR'
  | 'NOT_FOUND';

export class RemoteError extends Error {
  constructor(
    public readonly code: RemoteErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

export interface ConnectionTestResult {
  ok: boolean;
  status?: number;
  errorCode?: RemoteErrorCode;
  message: string;
  sampleUserCount?: number;
}

export interface ListUsersParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}

export interface ListUsersResult {
  items: MainServiceUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListUsageParams {
  page?: number;
  pageSize?: number;
  userId?: string | number;
}

export interface MainServiceClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const ALLOWED_PATHS = new Set([
  '/api/v1/admin/users',
  '/api/v1/admin/usage',
  '/api/v1/admin/usage/stats',
]);

export class MainServiceClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MainServiceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const result = await this.listUsers({ page: 1, pageSize: 1 });
      return {
        ok: true,
        status: 200,
        message: '连接成功',
        sampleUserCount: result.total,
      };
    } catch (error) {
      if (error instanceof RemoteError) {
        return {
          ok: false,
          status: error.status,
          errorCode: error.code,
          message: error.message,
        };
      }
      return {
        ok: false,
        errorCode: 'NETWORK',
        message: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  async listUsers(params: ListUsersParams = {}): Promise<ListUsersResult> {
    const query = new URLSearchParams();
    query.set('page', String(params.page ?? 1));
    query.set('page_size', String(params.pageSize ?? 20));
    if (params.search) query.set('search', params.search);
    if (params.status) query.set('status', params.status);

    const payload = await this.getJson(`/api/v1/admin/users?${query.toString()}`);
    const page = mainServicePaginatedSchema.parse(payload);
    const items = page.items.map((item) => mainServiceUserSchema.parse(item));
    return {
      items,
      total: page.total,
      page: page.page,
      pageSize: page.page_size,
    };
  }

  async getUser(userId: string | number): Promise<MainServiceUser> {
    const payload = await this.getJson(`/api/v1/admin/users/${userId}`);
    return mainServiceUserSchema.parse(payload);
  }

  async getUserBalance(userId: string | number): Promise<{
    balanceMinor: number;
    currency: string;
    raw: MainServiceUser;
  }> {
    const user = await this.getUser(userId);
    return {
      balanceMinor: parseMajorToMinor(user.balance ?? 0),
      currency: 'USD',
      raw: user,
    };
  }

  async getUserBalanceHistory(
    userId: string | number,
    page = 1,
    pageSize = 20,
  ): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    const payload = await this.getJson(
      `/api/v1/admin/users/${userId}/balance-history?${query.toString()}`,
    );
    return payload as Record<string, unknown>;
  }

  async getUserUsage(userId: string | number, period = 'month'): Promise<unknown> {
    const query = new URLSearchParams({ period });
    return this.getJson(`/api/v1/admin/users/${userId}/usage?${query.toString()}`);
  }

  async listUsage(params: ListUsageParams = {}): Promise<{
    items: MainServiceUsageLog[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const query = new URLSearchParams();
    query.set('page', String(params.page ?? 1));
    query.set('page_size', String(params.pageSize ?? 20));
    if (params.userId != null) query.set('user_id', String(params.userId));
    const payload = await this.getJson(`/api/v1/admin/usage?${query.toString()}`);
    const page = mainServicePaginatedSchema.parse(payload);
    const items = page.items.map((item) => mainServiceUsageLogSchema.parse(item));
    return {
      items,
      total: page.total,
      page: page.page,
      pageSize: page.page_size,
    };
  }

  async getUsageStats(): Promise<unknown> {
    return this.getJson('/api/v1/admin/usage/stats');
  }

  private async getJson(pathWithQuery: string): Promise<unknown> {
    const path = pathWithQuery.split('?')[0];
    const allowed =
      ALLOWED_PATHS.has(path) ||
      /^\/api\/v1\/admin\/users\/[^/]+$/.test(path) ||
      /^\/api\/v1\/admin\/users\/[^/]+\/(usage|balance-history)$/.test(path);
    if (!allowed) {
      throw new RemoteError('FORBIDDEN', `未登记的远程路径: ${path}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${pathWithQuery}`, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new RemoteError('UNAUTHORIZED', '主服务认证失败', 401);
      }
      if (response.status === 403) {
        throw new RemoteError('FORBIDDEN', '主服务拒绝访问', 403);
      }
      if (response.status === 404) {
        throw new RemoteError('NOT_FOUND', '主服务资源不存在', 404);
      }
      if (response.status === 429) {
        throw new RemoteError('RATE_LIMITED', '主服务限流', 429);
      }
      if (response.status >= 500) {
        throw new RemoteError('SERVER_ERROR', `主服务错误 ${response.status}`, response.status);
      }
      if (!response.ok) {
        throw new RemoteError('INVALID_RESPONSE', `主服务响应异常 ${response.status}`, response.status);
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new RemoteError('INVALID_RESPONSE', '主服务返回了非 JSON 响应', response.status);
      }

      const envelope = mainServiceEnvelopeSchema.safeParse(json);
      if (!envelope.success) {
        throw new RemoteError('INVALID_RESPONSE', '主服务响应 envelope 无效', response.status);
      }

      const code = envelope.data.code;
      if (typeof code === 'number' && code !== 0) {
        throw new RemoteError(
          'INVALID_RESPONSE',
          envelope.data.message || `主服务业务错误 code=${code}`,
          response.status,
        );
      }

      return envelope.data.data;
    } catch (error) {
      if (error instanceof RemoteError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RemoteError('TIMEOUT', `主服务请求超时 (${this.timeoutMs}ms)`);
      }
      throw new RemoteError(
        'NETWORK',
        error instanceof Error ? error.message : '主服务网络错误',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createMainServiceClient(
  baseUrl: string,
  apiKey: string,
  fetchImpl?: typeof fetch,
): MainServiceClient {
  return new MainServiceClient({ baseUrl, apiKey, fetchImpl });
}
