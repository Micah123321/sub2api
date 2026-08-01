import {
  mainServiceEnvelopeSchema,
  mainServiceLoginSchema,
  mainServicePaginatedSchema,
  mainServiceUsageLogSchema,
  mainServiceUserSchema,
  type MainServiceUsageLog,
  type MainServiceUser,
} from './schemas';
import { parseMajorToMinor } from '../common/money';
import { readLimitedJson, ResponseBodyError } from './read-limited-json';
import { resolveAllowedRemoteUrl, resolveRemoteBaseUrl } from './base-url';

export type RemoteErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'INVALID_RESPONSE'
  | 'SERVER_ERROR'
  | 'NOT_FOUND'
  | 'TWO_FACTOR_REQUIRED'
  | 'TURNSTILE_REQUIRED'
  | 'INSECURE_TRANSPORT';

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
  adminEmail: string;
  adminPassword: string;
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
  fetchImpl?: typeof fetch;
}

const MAX_RESPONSE_BYTES = 1024 * 1024;

interface RemoteResponse {
  status: number;
  ok: boolean;
  json: unknown;
}

export class MainServiceClient {
  private readonly baseUrl: string;
  private readonly adminEmail: string;
  private readonly adminPassword: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private accessToken: string | null = null;
  private loginPromise: Promise<string> | null = null;

  constructor(options: MainServiceClientOptions) {
    try {
      this.baseUrl = resolveRemoteBaseUrl(options.baseUrl, Boolean(options.allowInsecureHttp));
    } catch (error) {
      const message = error instanceof Error ? error.message : '主服务地址无效';
      const code = message.includes('HTTPS') ? 'INSECURE_TRANSPORT' : 'INVALID_RESPONSE';
      throw new RemoteError(code, message);
    }
    this.adminEmail = options.adminEmail;
    this.adminPassword = options.adminPassword;
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
    const payload = await this.getJson(`/api/v1/admin/users/${encodeURIComponent(String(userId))}`);
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
      `/api/v1/admin/users/${encodeURIComponent(String(userId))}/balance-history?${query.toString()}`,
    );
    return payload as Record<string, unknown>;
  }

  async getUserUsage(userId: string | number, period = 'month'): Promise<unknown> {
    const query = new URLSearchParams({ period });
    return this.getJson(
      `/api/v1/admin/users/${encodeURIComponent(String(userId))}/usage?${query.toString()}`,
    );
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
    let token = await this.getAccessToken();
    let response = await this.request(pathWithQuery, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
    });

    if (response.status === 401) {
      if (this.accessToken === token) {
        this.accessToken = null;
      }
      token = await this.getAccessToken();
      response = await this.request(pathWithQuery, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
        },
      });
    }

    return this.parseEnvelope(response);
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    if (!this.loginPromise) {
      const loginPromise = this.login();
      this.loginPromise = loginPromise;
      const clearLoginPromise = () => {
        if (this.loginPromise === loginPromise) {
          this.loginPromise = null;
        }
      };
      void loginPromise.then(clearLoginPromise, clearLoginPromise);
    }
    return this.loginPromise;
  }

  private async login(): Promise<string> {
    const response = await this.request('/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        email: this.adminEmail,
        password: this.adminPassword,
      }),
    });
    const payload = this.parseEnvelope(response);
    const login = mainServiceLoginSchema.safeParse(payload);
    if (!login.success) {
      throw new RemoteError('INVALID_RESPONSE', '主服务登录响应无效', response.status);
    }
    if ('requires_2fa' in login.data) {
      throw new RemoteError(
        'TWO_FACTOR_REQUIRED',
        '主服务管理员已启用两步验证，无法仅使用邮箱和密码登录',
        response.status,
      );
    }
    if (login.data.user.role.toLowerCase() !== 'admin') {
      throw new RemoteError('FORBIDDEN', '配置的主服务账号不是管理员', 403);
    }

    this.accessToken = login.data.access_token;
    return this.accessToken;
  }

  private async request(pathWithQuery: string, init: RequestInit): Promise<RemoteResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let url: string;
      try {
        url = resolveAllowedRemoteUrl(this.baseUrl, pathWithQuery, init.method || 'GET');
      } catch (error) {
        throw new RemoteError(
          'FORBIDDEN',
          error instanceof Error ? error.message : '远程请求路径无效',
        );
      }
      const response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        redirect: 'manual',
      });
      if (response.status >= 300 && response.status < 400) {
        throw new RemoteError('INVALID_RESPONSE', '主服务返回了不允许的重定向', response.status);
      }
      const json = await readLimitedJson(response, controller, MAX_RESPONSE_BYTES);
      return { status: response.status, ok: response.ok, json };
    } catch (error) {
      if (error instanceof RemoteError) {
        throw error;
      }
      if (error instanceof ResponseBodyError) {
        throw new RemoteError('INVALID_RESPONSE', error.message);
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

  private parseEnvelope(response: RemoteResponse): unknown {
    const envelope = mainServiceEnvelopeSchema.safeParse(response.json);
    const reason = envelope.success ? envelope.data.reason : undefined;
    if (reason === 'TURNSTILE_VERIFICATION_FAILED') {
      throw new RemoteError(
        'TURNSTILE_REQUIRED',
        '主服务启用了 Turnstile，后台邮箱/密码登录无法完成验证',
        response.status,
      );
    }
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

    if (!envelope.success) {
      throw new RemoteError('INVALID_RESPONSE', '主服务响应 envelope 无效', response.status);
    }

    const code = String(envelope.data.code);
    if (code !== '0') {
      throw new RemoteError(
        'INVALID_RESPONSE',
        envelope.data.message || `主服务业务错误 code=${code}`,
        response.status,
      );
    }

    return envelope.data.data;
  }
}

export function createMainServiceClient(
  baseUrl: string,
  adminEmail: string,
  adminPassword: string,
  fetchImpl?: typeof fetch,
  allowInsecureHttp = false,
): MainServiceClient {
  return new MainServiceClient({
    baseUrl,
    adminEmail,
    adminPassword,
    fetchImpl,
    allowInsecureHttp,
  });
}
