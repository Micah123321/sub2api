import type Database from 'better-sqlite3';
import { decryptSecret, encryptSecret } from '../common/crypto';
import { createRequestId } from '../common/ids';
import type { MainServiceClient, ConnectionTestResult } from '../remote/main-service-client';

export interface MainServiceSettingsView {
  configured: boolean;
  baseUrl: string;
  adminEmailMasked: string;
  passwordConfigured: boolean;
  credentialVersion: number;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface SaveMainServiceSettingsInput {
  baseUrl?: string;
  adminEmail?: string;
  adminPassword?: string;
  updatedBy?: string | null;
}

export interface MainServiceCredentials {
  baseUrl: string;
  adminEmail: string;
  adminPassword: string;
  credentialVersion: number;
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
    private readonly createClient: (
      baseUrl: string,
      adminEmail: string,
      adminPassword: string,
    ) => MainServiceClient,
  ) {}

  getView(): MainServiceSettingsView {
    const row = this.readRow();
    if (!row) {
      return emptyView();
    }

    let adminEmail: string;
    let passwordConfigured: boolean;
    try {
      adminEmail = row.admin_email_ciphertext
        ? decryptSecret(row.admin_email_ciphertext, this.masterKey)
        : '';
      passwordConfigured = Boolean(
        row.admin_password_ciphertext &&
          decryptSecret(row.admin_password_ciphertext, this.masterKey),
      );
    } catch {
      throw new SettingsError('DECRYPT_FAILED', '主服务管理员凭据解密失败');
    }

    return {
      configured: Boolean(adminEmail && passwordConfigured),
      baseUrl: row.base_url,
      adminEmailMasked: maskEmail(adminEmail),
      passwordConfigured,
      credentialVersion: row.credential_version,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  save(input: SaveMainServiceSettingsInput): MainServiceSettingsView {
    const existing = this.readRow();
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? existing?.base_url ?? '');
    if (!baseUrl) {
      throw new SettingsError('INVALID_INPUT', 'baseUrl 无效');
    }

    const adminEmail = input.adminEmail?.trim().toLowerCase();
    const adminPassword = input.adminPassword;
    let emailCiphertext = existing?.admin_email_ciphertext ?? '';
    let passwordCiphertext = existing?.admin_password_ciphertext ?? '';
    let credentialVersion = existing?.credential_version ?? 0;
    let configurationChanged = baseUrl !== existing?.base_url;

    if (existing && !adminEmail) {
      this.decryptExistingField(existing.admin_email_ciphertext);
    }
    if (existing && !adminPassword) {
      this.decryptExistingField(existing.admin_password_ciphertext);
    }

    if (adminEmail) {
      if (!isEmail(adminEmail)) {
        throw new SettingsError('INVALID_INPUT', '管理员邮箱格式无效');
      }
      emailCiphertext = encryptSecret(adminEmail, this.masterKey);
      configurationChanged = true;
    }
    if (adminPassword) {
      passwordCiphertext = encryptSecret(adminPassword, this.masterKey);
      configurationChanged = true;
    }
    if (!emailCiphertext || !passwordCiphertext) {
      throw new SettingsError('INVALID_INPUT', '首次配置必须提供管理员邮箱和密码');
    }
    if (configurationChanged) {
      credentialVersion += 1;
    }

    const now = Date.now();
    this.sqlite
      .prepare(
        `INSERT INTO main_service_settings
         (id, base_url, api_key_ciphertext, key_version, admin_email_ciphertext,
          admin_password_ciphertext, credential_version, updated_by, updated_at)
         VALUES (1, ?, '', 1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           base_url = excluded.base_url,
           admin_email_ciphertext = excluded.admin_email_ciphertext,
           admin_password_ciphertext = excluded.admin_password_ciphertext,
           credential_version = main_service_settings.credential_version + ?,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      )
      .run(
        baseUrl,
        emailCiphertext,
        passwordCiphertext,
        credentialVersion,
        input.updatedBy ?? null,
        now,
        configurationChanged ? 1 : 0,
      );

    return this.getView();
  }

  getCredentials(): MainServiceCredentials {
    const row = this.readRow();
    if (!row || !row.admin_email_ciphertext || !row.admin_password_ciphertext) {
      throw new SettingsError('NOT_CONFIGURED', '主服务管理员登录尚未配置');
    }
    try {
      return {
        baseUrl: row.base_url,
        adminEmail: decryptSecret(row.admin_email_ciphertext, this.masterKey),
        adminPassword: decryptSecret(row.admin_password_ciphertext, this.masterKey),
        credentialVersion: row.credential_version,
      };
    } catch {
      throw new SettingsError('DECRYPT_FAILED', '主服务管理员凭据解密失败');
    }
  }

  hasStoredCredentials(): boolean {
    const row = this.readRow();
    return Boolean(row?.admin_email_ciphertext && row.admin_password_ciphertext);
  }

  async testConnection(overrides?: {
    baseUrl?: string;
    adminEmail?: string;
    adminPassword?: string;
  }): Promise<ConnectionTestResult & { requestId: string }> {
    const requestId = createRequestId();
    const saved = this.tryGetCredentials();
    const baseUrl = normalizeBaseUrl(overrides?.baseUrl || saved?.baseUrl || '');
    const adminEmail = overrides?.adminEmail?.trim().toLowerCase() || saved?.adminEmail || '';
    const adminPassword = overrides?.adminPassword || saved?.adminPassword || '';

    if (!baseUrl || !adminEmail || !adminPassword) {
      throw new SettingsError('NOT_CONFIGURED', '请完整填写主服务地址、管理员邮箱和密码');
    }

    const client = this.createClient(baseUrl, adminEmail, adminPassword);
    const result = await client.testConnection();
    return { ...result, requestId };
  }

  private tryGetCredentials(): MainServiceCredentials | null {
    try {
      return this.getCredentials();
    } catch (error) {
      if (error instanceof SettingsError && error.code === 'NOT_CONFIGURED') {
        return null;
      }
      throw error;
    }
  }

  private readRow(): SettingsRow | undefined {
    return this.sqlite
      .prepare(
        `SELECT id, base_url, admin_email_ciphertext, admin_password_ciphertext,
                credential_version, updated_by, updated_at
         FROM main_service_settings
         WHERE id = 1`,
      )
      .get() as SettingsRow | undefined;
  }

  private decryptExistingField(ciphertext: string): void {
    if (!ciphertext) return;
    try {
      decryptSecret(ciphertext, this.masterKey);
    } catch {
      throw new SettingsError('DECRYPT_FAILED', '主服务管理员凭据解密失败');
    }
  }
}

interface SettingsRow {
  id: number;
  base_url: string;
  admin_email_ciphertext: string;
  admin_password_ciphertext: string;
  credential_version: number;
  updated_by: string | null;
  updated_at: number;
}

function emptyView(): MainServiceSettingsView {
  return {
    configured: false,
    baseUrl: '',
    adminEmailMasked: '',
    passwordConfigured: false,
    credentialVersion: 0,
    updatedAt: null,
    updatedBy: null,
  };
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return '';
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function maskEmail(value: string): string {
  const [local, domain] = value.split('@');
  if (!local || !domain) {
    return '';
  }
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
}
