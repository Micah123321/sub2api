import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { resolveMasterKey } from '../apps/server/src/common/crypto';
import { runMigrations } from '../apps/server/src/db/migrate';
import { MainServiceClient } from '../apps/server/src/remote/main-service-client';
import { SettingsService } from '../apps/server/src/settings/settings.service';

describe('main-service settings', () => {
  it('encrypts admin credentials and never exposes the password', () => {
    const sqlite = new Database(':memory:');
    runMigrations(sqlite);
    const masterKey = resolveMasterKey(Buffer.alloc(32, 9).toString('base64'));
    const service = new SettingsService(sqlite, masterKey, (baseUrl, email, password) =>
      new MainServiceClient({ baseUrl, adminEmail: email, adminPassword: password }),
    );

    const view = service.save({
      baseUrl: 'http://main.local/',
      adminEmail: 'Admin@Example.com',
      adminPassword: ' secret with spaces ',
    });

    expect(view).toMatchObject({
      configured: true,
      baseUrl: 'http://main.local',
      passwordConfigured: true,
      credentialVersion: 1,
    });
    expect(view.adminEmailMasked).toContain('@example.com');
    expect(view).not.toHaveProperty('adminPassword');

    const credentials = service.getCredentials();
    expect(credentials.adminEmail).toBe('admin@example.com');
    expect(credentials.adminPassword).toBe(' secret with spaces ');

    const row = sqlite
      .prepare(
        `SELECT admin_email_ciphertext, admin_password_ciphertext
         FROM main_service_settings`,
      )
      .get() as Record<string, string>;
    expect(JSON.stringify(row)).not.toContain('admin@example.com');
    expect(JSON.stringify(row)).not.toContain('secret with spaces');
  });

  it('preserves omitted fields and rotates the version when the base URL changes', () => {
    const sqlite = new Database(':memory:');
    runMigrations(sqlite);
    const masterKey = resolveMasterKey(Buffer.alloc(32, 3).toString('base64'));
    const service = new SettingsService(sqlite, masterKey, (baseUrl, email, password) =>
      new MainServiceClient({ baseUrl, adminEmail: email, adminPassword: password }),
    );
    service.save({
      baseUrl: 'http://main.local',
      adminEmail: 'admin@example.com',
      adminPassword: 'password-1',
    });

    const view = service.save({ baseUrl: 'http://main-2.local' });
    expect(view.credentialVersion).toBe(2);
    expect(service.getCredentials()).toMatchObject({
      baseUrl: 'http://main-2.local',
      adminEmail: 'admin@example.com',
      adminPassword: 'password-1',
    });

    const passwordOnly = service.save({ adminPassword: 'password-2' });
    expect(passwordOnly.credentialVersion).toBe(3);
    expect(service.getCredentials()).toMatchObject({
      baseUrl: 'http://main-2.local',
      adminEmail: 'admin@example.com',
      adminPassword: 'password-2',
    });
  });

  it('surfaces damaged credentials and keeps the settings singleton', () => {
    const sqlite = new Database(':memory:');
    runMigrations(sqlite);
    const key = resolveMasterKey(Buffer.alloc(32, 4).toString('base64'));
    const service = new SettingsService(sqlite, key, (baseUrl, email, password) =>
      new MainServiceClient({
        baseUrl,
        adminEmail: email,
        adminPassword: password,
        allowInsecureHttp: true,
      }),
    );
    service.save({
      baseUrl: 'http://main.local',
      adminEmail: 'admin@example.com',
      adminPassword: 'password-1',
    });

    const wrongKeyService = new SettingsService(
      sqlite,
      resolveMasterKey(Buffer.alloc(32, 8).toString('base64')),
      () => ({}) as MainServiceClient,
    );
    expect(wrongKeyService.hasStoredCredentials()).toBe(true);
    expect(() => wrongKeyService.getView()).toThrow('凭据解密失败');
    expect(() => wrongKeyService.save({ adminPassword: 'replacement' })).toThrow(
      '凭据解密失败',
    );
    const recovered = wrongKeyService.save({
      baseUrl: 'https://main.example.com',
      adminEmail: 'replacement@example.com',
      adminPassword: 'replacement-password',
    });
    expect(recovered).toMatchObject({ configured: true, credentialVersion: 2 });
    expect(wrongKeyService.getCredentials()).toMatchObject({
      adminEmail: 'replacement@example.com',
      adminPassword: 'replacement-password',
    });
    expect(
      (sqlite.prepare('SELECT COUNT(*) AS total FROM main_service_settings').get() as {
        total: number;
      }).total,
    ).toBe(1);
  });

  it('tests an unsaved override without returning credentials', async () => {
    const sqlite = new Database(':memory:');
    runMigrations(sqlite);
    const testConnection = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      message: '连接成功',
      sampleUserCount: 2,
    });
    const service = new SettingsService(
      sqlite,
      resolveMasterKey(Buffer.alloc(32, 5).toString('base64')),
      () => ({ testConnection }) as unknown as MainServiceClient,
    );

    const result = await service.testConnection({
      baseUrl: 'http://main.local',
      adminEmail: 'admin@example.com',
      adminPassword: 'password-1',
    });
    expect(result).toMatchObject({ ok: true, sampleUserCount: 2 });
    expect(testConnection).toHaveBeenCalledOnce();
  });
});
