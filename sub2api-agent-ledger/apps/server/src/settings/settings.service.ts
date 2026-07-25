import type Database from 'better-sqlite3';
import { decryptSecret, encryptSecret, maskSecret } from '../common/crypto';
import { createRequestId } from '../common/ids';
import type { MainServiceClient, ConnectionTestResult } from '../remote/main-service-client';

export interface MainServiceSettingsView {
  configured: boolean;
  baseUrl: string;
  apiKeyMasked: string;
  keyVersion: number;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface SaveMainServiceSettingsInput {
  baseUrl: string;
  apiKey?: string;
  updatedBy?: string | null;
}

export class SettingsError extends Error {
  constructor(
    public readonly code: 'INVALID_INPUT' | 'NOT_CONFIGURED' | 'DECRYPT_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'SettingsError';
  }
}

export class SettingsService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly masterKey: Buffer,
    private readonly createClient: (baseUrl: string, apiKey: string) => MainServiceClient,
  ) {}

  getView(): MainServiceSettingsView {
    const row = this.readRow();
    if (!row) {
      return {
        configured: false,
        baseUrl: '',
        apiKeyMasked: '',
        keyVersion: 0,
        updatedAt: null,
        updatedBy: null,
      };
    }

    let plain = '';
    try {
      plain = decryptSecret(row.api_key_ciphertext, this.masterKey);
    } catch {
      plain = '';
    }

    return {
      configured: true,
      baseUrl: row.base_url,
      apiKeyMasked: maskSecret(plain),
      keyVersion: row.key_version,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  save(input: SaveMainServiceSettingsInput): MainServiceSettingsView {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    if (!baseUrl) {
      throw new SettingsError('INVALID_INPUT', 'baseUrl 无效');
    }

    const existing = this.readRow();
    let ciphertext = existing?.api_key_ciphertext ?? '';
    let keyVersion = existing?.key_version ?? 1;

    if (input.apiKey && input.apiKey.trim()) {
      ciphertext = encryptSecret(input.apiKey.trim(), this.masterKey);
      keyVersion = (existing?.key_version ?? 0) + 1;
    }

    if (!ciphertext) {
      throw new SettingsError('INVALID_INPUT', '首次配置必须提供 Admin API Key');
    }

    const now = Date.now();
    if (existing) {
      this.sqlite
        .prepare(
          `UPDATE main_service_settings
           SET base_url = ?, api_key_ciphertext = ?, key_version = ?, updated_by = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(baseUrl, ciphertext, keyVersion, input.updatedBy ?? null, now, existing.id);
    } else {
      this.sqlite
        .prepare(
          `INSERT INTO main_service_settings
           (base_url, api_key_ciphertext, key_version, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(baseUrl, ciphertext, keyVersion, input.updatedBy ?? null, now);
    }

    return this.getView();
  }

  getCredentials(): { baseUrl: string; apiKey: string } {
    const row = this.readRow();
    if (!row) {
      throw new SettingsError('NOT_CONFIGURED', '主服务尚未配置');
    }
    try {
      return {
        baseUrl: row.base_url,
        apiKey: decryptSecret(row.api_key_ciphertext, this.masterKey),
      };
    } catch {
      throw new SettingsError('DECRYPT_FAILED', '主服务密钥解密失败');
    }
  }

  async testConnection(overrides?: {
    baseUrl?: string;
    apiKey?: string;
  }): Promise<ConnectionTestResult & { requestId: string }> {
    const requestId = createRequestId();
    let baseUrl = overrides?.baseUrl;
    let apiKey = overrides?.apiKey;

    if (!baseUrl || !apiKey) {
      const credentials = this.getCredentials();
      baseUrl = baseUrl || credentials.baseUrl;
      apiKey = apiKey || credentials.apiKey;
    }

    const client = this.createClient(normalizeBaseUrl(baseUrl), apiKey);
    const result = await client.testConnection();
    return { ...result, requestId };
  }

  private readRow():
    | {
        id: number;
        base_url: string;
        api_key_ciphertext: string;
        key_version: number;
        updated_by: string | null;
        updated_at: number;
      }
    | undefined {
    return this.sqlite
      .prepare(
        `SELECT id, base_url, api_key_ciphertext, key_version, updated_by, updated_at
         FROM main_service_settings
         ORDER BY id ASC
         LIMIT 1`,
      )
      .get() as
      | {
          id: number;
          base_url: string;
          api_key_ciphertext: string;
          key_version: number;
          updated_by: string | null;
          updated_at: number;
        }
      | undefined;
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    return '';
  }
  return trimmed;
}
